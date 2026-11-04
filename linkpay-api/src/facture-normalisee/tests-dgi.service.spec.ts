import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';
import { TestsDgiService } from './tests-dgi.service';

const ORG = '11111111-1111-1111-1111-111111111111';
const u = { id: 'u1', role: 'enterprise' };

function monter(o: { env?: 'test' | 'production'; droits?: 'gestion' | 'lecture'; factures?: Record<string, any>; lignesOrigine?: any[] } = {}) {
  const maj: { id: string; status: string }[] = [];
  const { service } = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'normalized_invoices' && has(q, 'update')) {
      maj.push({ id: q.calls.find((c) => c.method === 'eq')?.args[1], status: q.calls.find((c) => c.method === 'update')?.args[0].status });
      return { data: null };
    }
    if (q.target === 'normalized_invoices') {
      const src = q.calls.find((c) => c.method === 'eq' && c.args[0] === 'source_id')?.args[1];
      return { data: src ? (o.factures?.[src] ?? null) : [] };
    }
    if (q.target === 'normalized_invoice_items') return { data: o.lignesOrigine ?? [] };
    if (q.target === 'profiles') return { data: { full_name: 'Marie Kabila' } };
    return { data: null };
  });
  const profil = { enabled: true, nif: 'A2216742Y', emcf_environment: o.env ?? 'test', emcf_token_encrypted: 'x', allowed_tax_groups: ['A', 'B', 'C', 'E', 'H', 'K', 'O'] };
  const factures = {
    profil: jest.fn(async () => profil),
    emettre: jest.fn(async (d: any) => ({ id: 'nouvelle', rn: '2026/000001', invoice_type: d.facture.type, status: 'confirmed', code_def_dgi: 'D'.repeat(29) })),
    tenter: jest.fn(async (id: string) => ({ id, status: 'confirmed' })),
  } as any;
  const gestion = { droits: jest.fn(async () => o.droits ?? 'gestion'), tauxUsd: jest.fn(async () => '2850') } as any;
  const pins = { verifyPin: jest.fn(async () => undefined) } as any;
  return { svc: new TestsDgiService(service, factures, gestion, pins), factures, pins, gestion, maj };
}

const camp = '20261103-2130';

describe('Tests DGI (service)', () => {
  it('cas 4 en HT : facture de test sur sa source, au mode demandé, client PM au NIF de test', async () => {
    const { svc, factures } = monter();
    const r = await svc.jouer(ORG, u, { campagne: camp, mode: 'ht', num: 4 });
    expect(r).toMatchObject({ num: 4, mode: 'ht', etat: 'reussi' });
    const d = factures.emettre.mock.calls[0][0];
    expect(d).toMatchObject({ source: { type: 'manual', id: `dgi-test:${camp}:ht:4` }, mode: 'ht', facture: { type: 'FV', client: { type: 'PM', nif: 'A2216742Y' } } });
    expect(d.facture.articles.map((a: any) => a.quantite)).toEqual(['2.375', '3.5']);
  });

  it('cas 26 : équivalent USD au taux de l’e-MCF', async () => {
    const { svc, factures } = monter();
    await svc.jouer(ORG, u, { campagne: camp, mode: 'ttc', num: 26 });
    expect(factures.emettre.mock.calls[0][0].devise).toEqual({ code: 'USD', taux: '2850' });
  });

  it('un cas déjà réussi n’est pas refait ; un cas en échec est retenté avec le même numéro', async () => {
    const ok = monter({ factures: { [`dgi-test:${camp}:ttc:1`]: { id: 'f1', status: 'confirmed' } } });
    expect((await ok.svc.jouer(ORG, u, { campagne: camp, mode: 'ttc', num: 1 })).etat).toBe('reussi');
    expect(ok.factures.emettre).not.toHaveBeenCalled();
    // Refusée par la DGI : on range l'ancienne facture (abandonnée) et on en refait une avec la version actuelle.
    const ko = monter({ factures: { [`dgi-test:${camp}:ttc:1`]: { id: 'f1', status: 'failed', last_error_code: 'ECART' } } });
    await ko.svc.jouer(ORG, u, { campagne: camp, mode: 'ttc', num: 1 });
    expect(ko.factures.tenter).not.toHaveBeenCalled();
    expect(ko.factures.emettre).toHaveBeenCalledTimes(1);
    expect(ko.maj).toContainEqual({ id: 'f1', status: 'abandoned' });
    // Un bon provisoire (réseau) est simplement renvoyé, sans rien abandonner.
    const prov = monter({ factures: { [`dgi-test:${camp}:ttc:1`]: { id: 'f1', status: 'provisional' } } });
    await prov.svc.jouer(ORG, u, { campagne: camp, mode: 'ttc', num: 1 });
    expect(prov.factures.tenter).toHaveBeenCalledWith('f1');
    expect(prov.maj).toEqual([]);
  });

  it('avoir (cas 11) : code PIN, facture d’origine du même mode, lignes et quantités du document', async () => {
    const { svc, factures, pins } = monter({
      factures: { [`dgi-test:${camp}:ttc:3`]: { id: 'f3', status: 'confirmed' } },
      lignesOrigine: [
        { id: 'l1', line_no: 1, name: 'B', code: 'TEST-3-1', item_type: 'BIE', tax_group: 'B', unit_price_cents: 1160000, quantity: '2' },
        { id: 'l2', line_no: 2, name: 'A', code: 'TEST-3-2', item_type: 'BIE', tax_group: 'A', unit_price_cents: 250000, quantity: '3' },
      ],
    });
    await expect(svc.jouer(ORG, u, { campagne: camp, mode: 'ttc', num: 11 })).rejects.toBeInstanceOf(BadRequestException);
    await svc.jouer(ORG, u, { campagne: camp, mode: 'ttc', num: 11, pin: '1234' });
    expect(pins.verifyPin).toHaveBeenCalledWith('u1', '1234');
    const d = factures.emettre.mock.calls[0][0];
    expect(d).toMatchObject({ factureOrigineId: 'f3', facture: { type: 'FA', avoir: { nature: 'RAM' }, paiements: [{ moyen: 'ESPECES', montantCents: 1410000 }] } });
    expect(d.facture.articles.map((a: any) => [a.ligneOrigineId, a.quantite])).toEqual([['l1', '1'], ['l2', '1']]);
  });

  it('avoir sans sa facture d’origine normalisée : « faites d’abord le cas n° 1 »', async () => {
    const { svc } = monter();
    await expect(svc.jouer(ORG, u, { campagne: camp, mode: 'ttc', num: 10, pin: '1234' })).rejects.toThrow('cas n° 1');
  });

  it('refus : hors périmètre (groupe D), production, comptable', async () => {
    await expect(monter().svc.jouer(ORG, u, { campagne: camp, mode: 'ttc', num: 14 })).rejects.toThrow('hors périmètre');
    await expect(monter({ env: 'production' }).svc.jouer(ORG, u, { campagne: camp, mode: 'ttc', num: 1 })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(monter({ droits: 'lecture' }).svc.jouer(ORG, u, { campagne: camp, mode: 'ttc', num: 1 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('catalogue : 29 cas, hors périmètre signalés, prêt quand tout est en place', async () => {
    const e = await monter().svc.etat(ORG, u);
    expect(e.pret).toBe(true);
    expect(e.cas).toHaveLength(29);
    expect(e.cas.find((c) => c.num === 18)!.hors_perimetre).toBe('Groupes F, G non déclarés');
    expect(e.cas.find((c) => c.num === 1)!.hors_perimetre).toBeNull();
  });
});
