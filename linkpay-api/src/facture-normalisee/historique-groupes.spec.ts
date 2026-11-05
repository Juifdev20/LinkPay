import { ConfigService } from '@nestjs/config';
import { createFakeSupabase, has } from '../test-utils/fake-supabase';
import { FactureNormaliseeService } from './facture-normalisee.service';
import { GestionFiscaleService } from './gestion-fiscale.service';
import { journaliserGroupe } from './historique-groupes';
import { JetonFiscalService } from './jeton-fiscal.service';

const admin = { id: 'u-admin', role: 'admin' };

describe('Journal des changements de groupe de taxation', () => {
  it('écrit qui, quoi, ancien et nouveau groupe ; ne fait rien si le groupe ne change pas', async () => {
    const lignes: any[] = [];
    const { service } = createFakeSupabase((q) => {
      if (q.target === 'fiscal_group_history') lignes.push(q.calls.find((c) => c.method === 'insert')?.args[0]);
      return undefined;
    });
    const db = service.getClient();
    await journaliserGroupe(db, { organizationId: 'o1', scope: 'product', subjectId: 'p1', subjectLabel: 'Jus', ancien: 'b', nouveau: 'A', par: 'u1' });
    await journaliserGroupe(db, { organizationId: 'o1', scope: 'product', subjectId: 'p1', ancien: 'B', nouveau: 'b', par: 'u1' });
    await journaliserGroupe(db, { organizationId: 'o1', scope: 'category', ancien: undefined, nouveau: null, par: 'u1' });
    expect(lignes).toEqual([
      { organization_id: 'o1', scope: 'product', subject_id: 'p1', subject_label: 'Jus', old_group: 'B', new_group: 'A', changed_by: 'u1' },
    ]);
  });

  it('un produit qui reçoit un groupe, ou qui en perd un, est journalisé (null = sans groupe)', async () => {
    const lignes: any[] = [];
    const { service } = createFakeSupabase((q) => {
      lignes.push(q.calls.find((c) => c.method === 'insert')?.args[0]);
      return undefined;
    });
    await journaliserGroupe(service.getClient(), { organizationId: 'o1', scope: 'product', ancien: null, nouveau: 'B', par: 'u1' });
    await journaliserGroupe(service.getClient(), { organizationId: 'o1', scope: 'product', ancien: 'B', nouveau: null, par: 'u1' });
    expect(lignes.map((l) => [l.old_group, l.new_group])).toEqual([[null, 'B'], ['B', null]]);
  });

  it('une panne d’écriture du journal ne casse pas l’action de l’utilisateur', async () => {
    const { service } = createFakeSupabase(() => ({ error: { message: 'boom' } }));
    await expect(journaliserGroupe(service.getClient(), { organizationId: 'o1', scope: 'default', ancien: 'B', nouveau: 'C', par: 'u1' })).resolves.toBeUndefined();
  });
});

describe('Réglages et lecture du journal', () => {
  const config = { get: (k: string) => (k === 'JWT_SECRET' ? 'x'.repeat(40) : undefined) } as unknown as ConfigService;
  const monter = (avantCategorie: string | null) => {
    const journal: any[] = [];
    const { service } = createFakeSupabase((q) => {
      if (q.target === 'fiscal_group_history') {
        if (has(q, 'insert')) {
          journal.push(q.calls.find((c) => c.method === 'insert')?.args[0]);
          return undefined;
        }
        return {
          count: 2,
          data: [
            { id: 'h2', scope: 'category', subject_id: 'Boissons', subject_label: 'Boissons', old_group: 'B', new_group: 'A', changed_by: 'u1', changed_at: '2026-11-05T10:00:00Z' },
            { id: 'h1', scope: 'default', subject_id: null, subject_label: null, old_group: null, new_group: 'B', changed_by: null, changed_at: '2026-11-04T10:00:00Z' },
          ],
        };
      }
      if (q.target === 'profiles') return { data: [{ id: 'u1', full_name: 'Marie Kabila' }] };
      if (q.target === 'fiscal_category_groups') {
        const unique = has(q, 'maybeSingle');
        const ligne = avantCategorie ? { category: 'Boissons', tax_group: avantCategorie } : null;
        return { data: unique ? ligne : ligne ? [ligne] : [] };
      }
      if (q.target === 'fiscal_profiles') return { data: { organization_id: 'o1', enabled: true, nif: 'A2216742Y', vat_regime: 'assujetti', default_tax_group: 'B', allowed_tax_groups: ['A', 'B', 'C'], emcf_environment: 'test' } };
      if (q.target === 'rpc:fiscal_organization_categories') return { data: [] };
      return undefined;
    });
    const jetons = new JetonFiscalService(config);
    const factures = new FactureNormaliseeService(service, config, jetons);
    return { g: new GestionFiscaleService(service, factures, {} as any, {} as any), journal };
  };

  it('changer le groupe d’une catégorie écrit ancien → nouveau avec la personne', async () => {
    const { g, journal } = monter('B');
    await g.majGroupeCategorie('o1', admin, 'Boissons', 'A');
    expect(journal).toEqual([
      { organization_id: 'o1', scope: 'category', subject_id: 'Boissons', subject_label: 'Boissons', old_group: 'B', new_group: 'A', changed_by: 'u-admin' },
    ]);
  });

  it('enlever le groupe d’une catégorie est journalisé ; remettre le même groupe ne l’est pas', async () => {
    const a = monter('B');
    await a.g.majGroupeCategorie('o1', admin, 'Boissons', null);
    expect(a.journal).toHaveLength(1);
    expect(a.journal[0]).toMatchObject({ old_group: 'B', new_group: null });
    const b = monter('B');
    await b.g.majGroupeCategorie('o1', admin, 'Boissons', 'B');
    expect(b.journal).toHaveLength(0);
  });

  it('lecture : les plus récents d’abord, avec le nom de la personne ; une personne inconnue reste « Inconnu »', async () => {
    const { g } = monter(null);
    const r = await g.historiqueGroupes('o1', admin);
    expect(r.total).toBe(2);
    expect(r.lignes[0]).toMatchObject({ portee: 'category', sujet: 'Boissons', ancien: 'B', nouveau: 'A', par: 'Marie Kabila' });
    expect(r.lignes[1]).toMatchObject({ portee: 'default', ancien: null, nouveau: 'B', par: 'Inconnu' });
  });
});
