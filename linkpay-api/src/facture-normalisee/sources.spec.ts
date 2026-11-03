import { ConfigService } from '@nestjs/config';
import { createFakeSupabase } from '../test-utils/fake-supabase';
import { calculerTotaux } from './calcul';
import { FactureNormaliseeService } from './facture-normalisee.service';
import { GestionFiscaleService } from './gestion-fiscale.service';
import { JetonFiscalService } from './jeton-fiscal.service';
import { articlesEtPaiements, groupeParDefaut } from './sources';

const assujetti = { default_tax_group: null, vat_regime: 'assujetti' as const };
const nonAssujetti = { default_tax_group: null, vat_regime: 'non_assujetti' as const };

describe('D’une vente ScanLinkPay à une facture normalisée', () => {
  it('groupe par défaut : B (16 %) pour un assujetti, K pour un non-assujetti, sinon celui choisi', () => {
    expect(groupeParDefaut(assujetti)).toBe('B');
    expect(groupeParDefaut(nonAssujetti)).toBe('K');
    expect(groupeParDefaut({ default_tax_group: 'C', vat_regime: 'assujetti' })).toBe('C');
  });

  it('ticket en CDF : prix, groupes et codes du produit ; espèces → ESPECES, ScanLinkPay → AUTRE', () => {
    const { articles, paiements } = articlesEtPaiements(
      [
        { nom: 'Riz', quantite: 2, prixUnitaireCents: 11600, produit: { tax_group: 'B', dgi_item_type: 'BIE', dgi_item_code: null, barcode: '6001', specific_tax_cents: null, unit_of_measure: 'sac' } },
        { nom: 'Pain', quantite: 3, prixUnitaireCents: 500, produit: null },
      ],
      [
        { methode: 'cash', montantCents: 20000 },
        { methode: 'scanlinkpay', montantCents: 4700 },
      ],
      'CDF',
      null,
      nonAssujetti,
    );
    expect(articles[0]).toMatchObject({ groupe: 'B', code: '6001', type: 'BIE', prixUnitaireCents: 11600, quantite: '2', uniteMesure: 'sac' });
    expect(articles[1]).toMatchObject({ groupe: 'K', type: 'BIE' });
    expect(paiements).toEqual([
      { moyen: 'ESPECES', montantCents: 20000 },
      { moyen: 'AUTRE', montantCents: 4700 },
    ]);
  });

  it('ticket en USD : converti en CDF au taux de la DGI, et les paiements font exactement le total', () => {
    const { articles, paiements } = articlesEtPaiements(
      [
        { nom: 'Huile 5 L', quantite: 1, prixUnitaireCents: 1299, produit: { tax_group: 'B', dgi_item_type: null, dgi_item_code: null, barcode: null, specific_tax_cents: null, unit_of_measure: null } },
        { nom: 'Sucre', quantite: 3, prixUnitaireCents: 333, produit: null },
      ],
      [
        { methode: 'cash', montantCents: 1000 },
        { methode: 'scanlinkpay', montantCents: 1298 },
      ],
      'USD',
      '2850.55',
      assujetti,
    );
    expect(articles[0].prixUnitaireCents).toBe(Math.round(1299 * 2850.55)); // 12,99 $ → 37 028,64 CDF
    const total = calculerTotaux(articles, 'ttc').totalCents;
    expect(paiements.reduce((s, p) => s + p.montantCents, 0)).toBe(total);
    expect(paiements.every((p) => p.devise === 'USD' && p.taux === '2850.55')).toBe(true);
  });

  it('refuse un ticket en USD sans taux du dollar (on ne devine jamais un taux)', () => {
    expect(() => articlesEtPaiements([{ nom: 'X', quantite: 1, prixUnitaireCents: 100, produit: null }], [], 'USD', null, assujetti)).toThrow('Taux du dollar');
  });

  it('la taxe spécifique du produit est comptée pour toute la quantité', () => {
    const { articles } = articlesEtPaiements(
      [{ nom: 'Bière', quantite: 4, prixUnitaireCents: 2000, produit: { tax_group: 'B', dgi_item_type: 'BIE', dgi_item_code: null, barcode: null, specific_tax_cents: 150, unit_of_measure: null } }],
      [],
      'CDF',
      null,
      assujetti,
    );
    expect(articles[0].taxeSpecifiqueCents).toBe(600);
  });
});

describe('Qui peut gérer la facture normalisée', () => {
  const config = { get: (k: string) => (k === 'JWT_SECRET' ? 'x'.repeat(40) : undefined) } as unknown as ConfigService;
  const gestion = (reponses: Record<string, any>) => {
    const { service } = createFakeSupabase((q) => (reponses[q.target] ? { data: reponses[q.target] } : undefined));
    const jetons = new JetonFiscalService(config);
    return new GestionFiscaleService(service, new FactureNormaliseeService(service, config, jetons), {} as any, {} as any);
  };

  it('le patron (propriétaire) et un gérant actif gèrent ; un comptable lit ; un caissier non', async () => {
    const g = gestion({ organizations: { id: 'o1', owner_id: 'patron' }, organization_staff: { deactivated_at: null } });
    await expect(g.droits('o1', { id: 'patron', role: 'enterprise' })).resolves.toBe('gestion');
    await expect(g.droits('o1', { id: 'g1', role: 'gerant', organization_id: 'o1' })).resolves.toBe('gestion');
    await expect(g.droits('o1', { id: 'c1', role: 'comptable', organization_id: 'o1' })).resolves.toBe('lecture');
    await expect(g.droits('o1', { id: 'k1', role: 'caissier', organization_id: 'o1' })).rejects.toThrow('patron et aux gérants');
    await expect(g.droits('o1', { id: 'g2', role: 'gerant', organization_id: 'autre' })).rejects.toThrow();
  });

  it('un gérant désactivé ne gère plus', async () => {
    const g = gestion({ organizations: { id: 'o1', owner_id: 'patron' }, organization_staff: { deactivated_at: '2026-10-01' } });
    await expect(g.droits('o1', { id: 'g1', role: 'gerant', organization_id: 'o1' })).rejects.toThrow();
  });

  it('refuse un NIF mal formé', async () => {
    const g = gestion({ organizations: { id: 'o1', owner_id: 'patron' } });
    await expect(g.majProfil('o1', { id: 'patron' }, { nif: 'A22-167' })).rejects.toThrow('9 caractères');
  });

  it('refuse l’activation sans jeton e-MCF', async () => {
    const g = gestion({ organizations: { id: 'o1', owner_id: 'patron' }, fiscal_profiles: { nif: 'A2216742Y', emcf_token_encrypted: null } });
    await expect(g.activer('o1', { id: 'patron' }, true)).rejects.toThrow('jeton e-MCF');
  });
});
