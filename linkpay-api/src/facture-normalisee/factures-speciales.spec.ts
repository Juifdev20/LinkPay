import { ConfigService } from '@nestjs/config';
import { createFakeSupabase } from '../test-utils/fake-supabase';
import { FactureNormaliseeService } from './facture-normalisee.service';
import { GestionFiscaleService } from './gestion-fiscale.service';
import { JetonFiscalService } from './jeton-fiscal.service';
import { LOGICIEL } from './logiciel';

const admin = { id: 'u-admin', role: 'admin' };
const config = (isf?: string) => ({ get: (k: string) => (k === 'JWT_SECRET' ? 'x'.repeat(40) : k === 'EMCF_ISF' ? isf : undefined) }) as unknown as ConfigService;

describe('Factures spéciales : un seul moyen de paiement, total calculé par le serveur', () => {
  const monter = (mode: 'ttc' | 'ht' = 'ttc') => {
    const emettre = jest.fn(async (d: any) => ({ id: 'f1', ...d }));
    const factures = { profil: async () => ({ price_mode: mode }), emettre, isfAffiche: () => null } as any;
    const { service } = createFakeSupabase(() => undefined);
    return { g: new GestionFiscaleService(service, factures, {} as any, { verifyPin: jest.fn() } as any), emettre };
  };
  const article = { nom: 'Acompte matériel', type: 'BIE' as const, groupe: 'B' as const, prixUnitaireCents: 11600, quantite: '2' };
  const client = { type: 'PM' as const, nom: 'CLIENT SARL', nif: 'A2216742Y' };

  it('acompte payé par virement : le paiement est égal au total TTC calculé', async () => {
    const { g, emettre } = monter('ttc');
    await g.manuelle('o1', admin, { type: 'FT', articles: [article], client, moyen_paiement: 'VIREMENT' });
    expect(emettre.mock.calls[0][0].facture.paiements).toEqual([{ moyen: 'VIREMENT', montantCents: 23200 }]);
    expect(emettre.mock.calls[0][0].facture.type).toBe('FT');
  });

  it('en mode HT, la TVA est ajoutée au total du paiement (11 600 HT × 2 en B → 26 912)', async () => {
    const { g, emettre } = monter('ht');
    await g.manuelle('o1', admin, { type: 'EV', articles: [{ ...article, groupe: 'B' }], client, moyen_paiement: 'ESPECES' });
    expect(emettre.mock.calls[0][0].facture.paiements).toEqual([{ moyen: 'ESPECES', montantCents: 26912 }]);
  });

  it('des paiements fournis sont gardés tels quels (pas écrasés)', async () => {
    const { g, emettre } = monter();
    const paiements = [{ moyen: 'MOBILEMONEY' as const, montantCents: 23200 }];
    await g.manuelle('o1', admin, { type: 'FT', articles: [article], client, paiements, moyen_paiement: 'VIREMENT' });
    expect(emettre.mock.calls[0][0].facture.paiements).toEqual(paiements);
  });

  it('remise RRR : avoir sans facture d’origine, avec le PIN, remboursée par le moyen choisi', async () => {
    const { g, emettre } = monter();
    await g.manuelle('o1', admin, { type: 'FA', nature_avoir: 'RRR', pin: '1234', articles: [{ ...article, prixUnitaireCents: 1000, quantite: '1' }], client, moyen_paiement: 'ESPECES' });
    const f = emettre.mock.calls[0][0].facture;
    expect(f.avoir).toEqual({ nature: 'RRR' });
    expect(f.paiements).toEqual([{ moyen: 'ESPECES', montantCents: 1000 }]);
    await expect(g.manuelle('o1', admin, { type: 'FA', nature_avoir: 'RRR', articles: [article], client, moyen_paiement: 'ESPECES' })).rejects.toThrow('PIN');
  });

  it('des articles invalides ne cassent pas le calcul : la validation de la facture les refusera', async () => {
    const { g, emettre } = monter();
    await g.manuelle('o1', admin, { type: 'FT', articles: [{ ...article, quantite: '0' }], client, moyen_paiement: 'ESPECES' });
    expect(emettre.mock.calls[0][0].facture.paiements).toEqual([]);
  });
});

describe('À propos : nom, version et ISF du logiciel', () => {
  const service = (isf?: string) => {
    const { service: db } = createFakeSupabase(() => undefined);
    return new FactureNormaliseeService(db, config(isf), new JetonFiscalService(config(isf)));
  };

  it('en test : l’ISF de test ; configuré : celui de la DGI ; en production sans ISF : rien (jamais d’invention)', () => {
    expect(service().isfAffiche('test')).toBe('SLP-SFE-01');
    expect(service('ABC-DEF-01').isfAffiche('production')).toBe('ABC-DEF-01');
    expect(service().isfAffiche('production')).toBeNull();
  });

  it('le profil expose le logiciel (nom, version, ISF, environnement)', async () => {
    const { service: db } = createFakeSupabase((q) => {
      if (q.target === 'fiscal_profiles') return { data: { organization_id: 'o1', enabled: false, emcf_environment: 'test', vat_regime: 'assujetti', allowed_tax_groups: ['A', 'B'] } };
      return undefined;
    });
    const factures = new FactureNormaliseeService(db, config(), new JetonFiscalService(config()));
    const g = new GestionFiscaleService(db, factures, {} as any, {} as any);
    const r = await g.voirProfil('o1', admin);
    expect(r.logiciel).toEqual({ nom: LOGICIEL.nom, module: LOGICIEL.module, version: LOGICIEL.version, environnement: 'test', isf: 'SLP-SFE-01' });
  });
});
