import { ConfigService } from '@nestjs/config';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';
import { ErreurEmcf } from './emcf.client';
import { anneeDeGestion, FactureNormaliseeService, miseAJour, nettoyerJeton } from './facture-normalisee.service';
import { JetonFiscalService } from './jeton-fiscal.service';

const config = (v: Record<string, string> = {}) =>
  ({ get: (k: string) => ({ JWT_SECRET: 'secret-de-test-assez-long-pour-les-tests-0123456789', ...v })[k] }) as unknown as ConfigService;

describe('Jeton e-MCF chiffré', () => {
  it('se déchiffre à l’identique, ne s’écrit jamais en clair, et change à chaque chiffrement', () => {
    const j = new JetonFiscalService(config());
    const jeton = 'eyJhbGciOiJIUzI1NiJ9.jeton-de-test-e-mcf.signature';
    const a = j.chiffrer(jeton);
    const b = j.chiffrer(jeton);
    expect(a).not.toContain('jeton-de-test');
    expect(a).not.toBe(b);
    expect(j.dechiffrer(a)).toBe(jeton);
    expect(j.indice(jeton)).toBe('ture');
  });

  it('refuse un jeton chiffré avec une autre clé', () => {
    const a = new JetonFiscalService(config()).chiffrer('x'.repeat(30));
    const autre = new JetonFiscalService(config({ FISCAL_TOKEN_ENCRYPTION_KEY: 'une-autre-cle' }));
    expect(() => autre.dechiffrer(a)).toThrow();
  });
});

describe('Ce que devient la facture selon la réponse de la DGI', () => {
  const montantsDgi = { uid: 'u1', total: 116, vtotal: 16 };

  it('confirmée : éléments de sécurité enregistrés', () => {
    const m = miseAJour(
      { statut: 'confirmee', uid: 'u1', montantsDgi, elements: { codeDEFDGI: 'C'.repeat(29), qrCode: 'RDCDEF01;…', counters: '1/1 FV', nim: 'N1', dateTime: '03/11/2026 14:44:23' } },
      0,
    );
    expect(m).toMatchObject({ status: 'confirmed', code_def_dgi: 'C'.repeat(29), attempts: 1, last_error_code: null });
  });

  it('DGI injoignable : bon provisoire, repris automatiquement plus tard', () => {
    expect(miseAJour({ statut: 'injoignable', erreur: new ErreurEmcf('reseau', 'réseau') }, 2)).toMatchObject({ status: 'provisional', attempts: 3 });
  });

  it('montants différents : échec avec le détail de l’écart', () => {
    const m = miseAJour({ statut: 'ecart', uid: 'u1', montantsDgi, ecarts: [{ champ: 'vtotal', nous: 1600, dgi: 1601 }] }, 0);
    expect(m).toMatchObject({ status: 'failed', last_error_code: 'ECART' });
    expect(m.last_error_desc).toContain('vtotal 16 ≠ 16.01');
  });

  it('confirmation sans réponse sûre : « à vérifier », jamais renvoyée automatiquement', () => {
    const m = miseAJour({ statut: 'a_verifier', uid: 'u1', montantsDgi, erreur: new ErreurEmcf('delai', 'délai') }, 0);
    expect(m).toMatchObject({ status: 'failed', last_error_code: 'A_VERIFIER', emcf_uid: 'u1' });
  });

  it('refus de la DGI : son code est gardé', () => {
    expect(miseAJour({ statut: 'refusee', erreur: new ErreurEmcf('refus', 'refus', '12', 'avoir trop grand') }, 0)).toMatchObject({
      status: 'failed',
      last_error_code: '12',
    });
  });

  it("l'année de gestion suit l'heure de Kinshasa (UTC+1)", () => {
    expect(anneeDeGestion(new Date('2026-12-31T23:30:00Z'))).toBe(2027);
    expect(anneeDeGestion(new Date('2026-12-31T22:30:00Z'))).toBe(2026);
  });
});

describe('Reprise après un arrêt du serveur entre la confirmation DGI et l’enregistrement', () => {
  it('reprend les codes depuis le journal au lieu de renvoyer la facture (pas de doublon à la DGI)', async () => {
    const jetons = new JetonFiscalService(config());
    const appels: RecordedQuery[] = [];
    const { service } = createFakeSupabase((q) => {
      appels.push(q);
      if (q.target === 'normalized_invoices' && q.calls[0].method === 'select') {
        return { data: { id: 'f1', organization_id: 'o1', status: 'pending', last_error_code: null, attempts: 1, rn: '2026/000001' } };
      }
      if (q.target === 'fiscal_profiles') {
        return { data: { organization_id: 'o1', enabled: true, nif: 'A2216742Y', emcf_environment: 'test', emcf_token_encrypted: jetons.chiffrer('j'.repeat(30)) } };
      }
      if (q.target === 'emcf_exchanges') {
        return {
          data: [
            {
              path: '/edef/api/invoice/uid-123/CONFIRM',
              response_body: { codeDEFDGI: 'D'.repeat(29), qrCode: 'RDCDEF01;X', counters: '7/7 FV', nim: 'TE01', dateTime: '03/11/2026 10:00:00' },
            },
          ],
        };
      }
      if (q.target === 'normalized_invoices' && q.calls[0].method === 'update') {
        return { data: { id: 'f1', status: 'confirmed', code_def_dgi: 'D'.repeat(29) } };
      }
      return undefined;
    });
    const s = new FactureNormaliseeService(service, config(), jetons);
    const r = await s.tenter('f1');
    expect(r.status).toBe('confirmed');
    const maj = appels.find((q) => q.target === 'normalized_invoices' && q.calls[0].method === 'update')!;
    expect(maj.calls[0].args[0]).toMatchObject({ status: 'confirmed', emcf_uid: 'uid-123', code_def_dgi: 'D'.repeat(29) });
    // Aucun appel à la DGI n'a été tenté : rien d'autre qu'une lecture du journal.
    expect(appels.filter((q) => q.target === 'emcf_exchanges').every((q) => q.calls[0].method === 'select')).toBe(true);
  });

  it('une facture « à vérifier » n’est jamais renvoyée', async () => {
    const appels: RecordedQuery[] = [];
    const { service } = createFakeSupabase((q) => {
      appels.push(q);
      if (q.target === 'normalized_invoices') return { data: { id: 'f2', status: 'failed', last_error_code: 'A_VERIFIER' } };
      return undefined;
    });
    const s = new FactureNormaliseeService(service, config(), new JetonFiscalService(config()));
    const r = await s.tenter('f2');
    expect(r.last_error_code).toBe('A_VERIFIER');
    expect(appels.map((q) => q.target)).toEqual(['normalized_invoices']);
  });
});

describe('Émission : refusée tant que la facture normalisée n’est pas activée', () => {
  it('explique pourquoi', async () => {
    const { service } = createFakeSupabase((q) => (q.target === 'fiscal_profiles' ? { data: { enabled: false } } : undefined));
    const s = new FactureNormaliseeService(service, config(), new JetonFiscalService(config()));
    await expect(
      s.emettre({
        organizationId: 'o1',
        source: { type: 'pos_ticket', id: 't1' },
        facture: { type: 'FV', articles: [], client: { type: 'PP' }, paiements: [] },
        operateur: { nom: 'Jacques' },
      }),
    ).rejects.toThrow("n'est pas activée");
  });

  it("l'ISF de production est exigé ; en test, une valeur au bon format suffit", () => {
    const s = new FactureNormaliseeService(createFakeSupabase(() => undefined).service, config(), new JetonFiscalService(config()));
    expect(s.isf('test')).toMatch(/^[A-Z]{3}-[A-Z]{3}-\d{2}$/);
    expect(() => s.isf('production')).toThrow('ISF');
    const s2 = new FactureNormaliseeService(createFakeSupabase(() => undefined).service, config({ EMCF_ISF: 'SLP-ABC-01' }), new JetonFiscalService(config()));
    expect(s2.isf('production')).toBe('SLP-ABC-01');
  });
});

describe('Jeton collé depuis le portail', () => {
  it('retire les retours à la ligne, espaces, guillemets et « Bearer »', () => {
    expect(nettoyerJeton('  eyJhbGci.abc\n def.ghi \r\n ')).toBe('eyJhbGci.abcdef.ghi');
    expect(nettoyerJeton('Bearer eyJ.abc.def')).toBe('eyJ.abc.def');
    expect(nettoyerJeton('"eyJ.abc.def"')).toBe('eyJ.abc.def');
    expect(nettoyerJeton(undefined)).toBe('');
  });
});

describe('Facture refusée pour « montants différents » : les totaux sont refaits avant le nouvel essai', () => {
  const lignes = [
    { unit_price_cents: 200000, quantity: '1', tax_group: 'B', specific_tax_cents: null },
    { unit_price_cents: 300000, quantity: '1', tax_group: 'A', specific_tax_cents: null },
  ];
  const anciens = {
    groupes: [
      { groupe: 'A', taux: 0, totalCents: 300000, baseCents: 300000, tvaCents: 0 },
      { groupe: 'B', taux: 16, totalCents: 200000, baseCents: 172413, tvaCents: 27587 },
    ],
    montantsLignes: [200000, 300000],
    taxeSpecifiqueCents: 0,
    totalCents: 500000,
    tvaCents: 27587,
  };

  it('le nouveau calcul (base 1 724,14 / TVA 275,86, comme l’e-MCF) remplace l’ancien et est enregistré', async () => {
    const ecritures: any[] = [];
    const { service } = createFakeSupabase((q) => {
      if (q.target === 'normalized_invoice_items') return { data: lignes };
      if (q.target === 'normalized_invoices') {
        const maj = q.calls.find((c) => c.method === 'update');
        if (maj) ecritures.push(maj.args[0]);
      }
      return undefined;
    });
    const s = new FactureNormaliseeService(service, config(), new JetonFiscalService(config())) as any;
    const f = { id: 'f1', rn: '2026/000157', price_mode: 'ttc', last_error_code: 'ECART', computed_totals: anciens };
    const r = await s.recalculerSiEcart(f);
    expect(r.computed_totals.groupes.find((g: any) => g.groupe === 'B')).toMatchObject({ baseCents: 172414, tvaCents: 27586 });
    expect(r.total_cents).toBe(500000);
    expect(r.vat_cents).toBe(27586);
    expect(ecritures).toEqual([{ computed_totals: r.computed_totals, total_cents: 500000, vat_cents: 27586 }]);
  });

  it('une facture refusée pour une autre raison, ou déjà à jour, n’est pas touchée', async () => {
    const ecritures: any[] = [];
    const { service } = createFakeSupabase((q) => {
      if (q.target === 'normalized_invoice_items') return { data: lignes };
      if (q.calls.some((c) => c.method === 'update')) ecritures.push(q);
      return undefined;
    });
    const s = new FactureNormaliseeService(service, config(), new JetonFiscalService(config())) as any;
    const autre = { id: 'f2', price_mode: 'ttc', last_error_code: 'A_VERIFIER', computed_totals: anciens };
    expect(await s.recalculerSiEcart(autre)).toBe(autre);
    const f = { id: 'f3', price_mode: 'ttc', last_error_code: 'ECART', computed_totals: anciens };
    const r1 = await s.recalculerSiEcart(f);
    const r2 = await s.recalculerSiEcart({ ...f, computed_totals: r1.computed_totals });
    expect(r2.computed_totals).toEqual(r1.computed_totals);
    expect(ecritures).toHaveLength(1); // une seule écriture : la seconde fois, rien à changer
  });
});
