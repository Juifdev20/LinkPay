import { articlesDuCas, CAS_TESTS_DGI, clientDuCas, groupesManquants, sourceDuCas } from './cas-tests-dgi';
import { calculerTotaux } from './calcul';
import { GROUPES_HOMOLOGUES, TAUX_2026 } from './groupes';
import { construireRequete, valeurParUnite } from './requete';
import { validerFacture } from './validation';

const clients = { nif: 'A2216742Y' };
const dansLePerimetre = CAS_TESTS_DGI.filter((c) => groupesManquants(c, GROUPES_HOMOLOGUES).length === 0);

describe('Cas de test DGI (document v1.2)', () => {
  it('les 29 cas sont décrits, numérotés de 1 à 29', () => {
    expect(CAS_TESTS_DGI.map((c) => c.num)).toEqual(Array.from({ length: 29 }, (_, i) => i + 1));
  });

  it('périmètre de ScanLinkPay (groupes A, B, C, E, H, K, O) : 22 cas, les autres sont hors périmètre', () => {
    expect(dansLePerimetre.map((c) => c.num)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 19, 22, 25, 26, 27, 29]);
    expect(groupesManquants(CAS_TESTS_DGI[13], GROUPES_HOMOLOGUES)).toEqual(['D']);
  });

  it('un avoir rembourse des articles de la facture de son cas d’origine', () => {
    for (const c of CAS_TESTS_DGI.filter((x) => x.avoir?.origine)) {
      const origine = CAS_TESTS_DGI.find((x) => x.num === c.avoir!.origine)!;
      expect(origine.avoir).toBeUndefined();
      expect(origine.client).toBe(c.client);
      for (const a of c.articles) expect(origine.articles.some((o) => o.groupe === a.groupe)).toBe(true);
    }
  });

  for (const mode of ['ttc', 'ht'] as const) {
    it(`chaque cas du périmètre passe toutes nos règles en ${mode.toUpperCase()}`, () => {
      for (const c of dansLePerimetre) {
        const articles = articlesDuCas(c);
        const total = calculerTotaux(articles, mode).totalCents;
        const facture = {
          type: c.type,
          mode,
          articles,
          client: clientDuCas(c, clients),
          paiements: [{ moyen: c.moyen ?? ('ESPECES' as const), montantCents: total }],
          groupesAutorises: GROUPES_HOMOLOGUES,
          avoir: c.avoir ? { nature: c.avoir.nature, referenceCode: c.avoir.nature === 'RRR' ? undefined : 'C'.repeat(29) } : undefined,
        };
        const v = validerFacture(facture);
        expect({ cas: c.num, erreurs: v.ok ? [] : v.erreurs }).toEqual({ cas: c.num, erreurs: [] });
        const r = construireRequete(facture, { nif: 'A2216742Y', rn: `2026/${c.num}`, isf: 'SLP-SFE-01', operateur: { nom: 'Test' } });
        expect(r.mode).toBe(mode);
      }
    });
  }

  it('cas 4 : quantités à 3 décimales ; cas 8 : taxe spécifique pour toute la quantité ; cas 25 : remises ; cas 29 : HORS CHAMP', () => {
    expect(articlesDuCas(CAS_TESTS_DGI[3]).map((a) => a.quantite)).toEqual(['2.375', '3.5']);
    expect(articlesDuCas(CAS_TESTS_DGI[7]).map((a) => (a as any).taxeSpecifiqueCents)).toEqual([150000, 40000, undefined]);
    expect(articlesDuCas(CAS_TESTS_DGI[24]).map((a) => (a as any).modificationPrix)).toEqual(['Remise 10 %', undefined, 'Remise 300 CDF']);
    expect(articlesDuCas(CAS_TESTS_DGI[28])[0].code).toBe('HORS CHAMP');
    // Cas 27 : 1 × O à 1 %.
    expect(TAUX_2026.O).toBe(1);
  });

  it('chaque facture de test a une source à elle (pas de doublon dans une campagne)', () => {
    expect(sourceDuCas('20261103-2130', 'ht', 10)).toBe('dgi-test:20261103-2130:ht:10');
  });
});

describe('Taxe spécifique : la DGI veut le montant total ET la valeur par unité (code 22)', () => {
  const facture = (mode: 'ttc' | 'ht') => {
    const c = CAS_TESTS_DGI[7];
    const articles = articlesDuCas(c);
    return {
      type: c.type,
      mode,
      articles,
      client: clientDuCas(c, clients),
      paiements: [{ moyen: 'ESPECES' as const, montantCents: calculerTotaux(articles, mode).totalCents }],
      groupesAutorises: GROUPES_HOMOLOGUES,
    };
  };

  it('cas 8 : taxSpecificAmount pour toute la quantité, taxSpecificValue par unité', () => {
    for (const mode of ['ttc', 'ht'] as const) {
      const r: any = construireRequete(facture(mode), { nif: 'A2216742Y', rn: '2026/8', isf: 'SLP-SFE-01', operateur: { nom: 'T' } });
      expect(r.items.map((i: any) => [i.taxSpecificAmount, i.taxSpecificValue])).toEqual([
        [1500, '500'], // 3 × B : 500 CDF par unité
        [400, '200'], // 2 × C : 200 CDF par unité
        [undefined, undefined], // 1 × A : sans taxe spécifique
      ]);
    }
  });

  it('valeur par unité déduite du total quand l’unité n’est pas connue', () => {
    expect(valeurParUnite(150000, '3')).toBe(50000);
    expect(valeurParUnite(100000, '3')).toBe(33333);
    expect(valeurParUnite(125000, '2.5')).toBe(50000);
  });
});

describe('Opérateur envoyé à la DGI', () => {
  it('le nom seulement, sans identifiant interne (UUID)', () => {
    const c = CAS_TESTS_DGI[0];
    const articles = articlesDuCas(c);
    const r: any = construireRequete(
      { type: c.type, mode: 'ttc', articles, client: clientDuCas(c, clients), paiements: [{ moyen: 'ESPECES', montantCents: calculerTotaux(articles, 'ttc').totalCents }], groupesAutorises: GROUPES_HOMOLOGUES },
      { nif: 'A2216742Y', rn: '2026/1', isf: 'SLP-SFE-01', operateur: { id: '0517627c-3fa9-4ca0-85c6-5dfae953587a', nom: 'DIEUDONNE MERCI JEAN' } },
    );
    expect(r.operator).toEqual({ name: 'DIEUDONNE MERCI JEAN' });
  });
});
