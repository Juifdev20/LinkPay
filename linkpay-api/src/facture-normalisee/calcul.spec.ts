import { calculerTotaux, cdfVersUsd, montantLigne, numeroFacture, quantiteEnMilliemes, tauxDansLaMarge, usdVersCdf } from './calcul';

describe('Facture normalisée — moteur de calcul (note de service 01/022, 1.5)', () => {
  describe('quantités (3 décimales au plus)', () => {
    it('accepte 2,375 et 3.5, refuse 4 décimales, zéro et le négatif', () => {
      expect(quantiteEnMilliemes('2,375')).toBe(2375n);
      expect(quantiteEnMilliemes(3.5)).toBe(3500n);
      expect(quantiteEnMilliemes('12')).toBe(12000n);
      expect(() => quantiteEnMilliemes('1.2345')).toThrow();
      expect(() => quantiteEnMilliemes('0')).toThrow();
      expect(() => quantiteEnMilliemes('-1')).toThrow();
    });

    it('arrondit le montant de la ligne au centime le plus proche', () => {
      expect(montantLigne(1000, '2.375')).toBe(2375); // 23,75
      expect(montantLigne(333, '2.375')).toBe(791); // 7,90875 → 7,91
      expect(montantLigne(1234, '3.5')).toBe(4319);
      expect(() => montantLigne(0, 1)).toThrow();
      expect(() => montantLigne(10.5, 1)).toThrow();
    });
  });

  describe('mode TTC : la TVA se déduit du total du groupe, arrondie au centime le plus proche ; la base est le reste', () => {
    it('116,00 en B (16 %) → base 100,00, TVA 16,00', () => {
      const t = calculerTotaux([{ prixUnitaireCents: 11600, quantite: 1, groupe: 'B' }], 'ttc');
      expect(t.groupes).toEqual([{ groupe: 'B', taux: 16, totalCents: 11600, baseCents: 10000, tvaCents: 1600 }]);
      expect(t.totalCents).toBe(11600);
      expect(t.tvaCents).toBe(1600);
    });

    it("arrondi au centime le plus proche : 10,01 → TVA 1,38 (1,3807), base 8,63 ; base + TVA = total", () => {
      const t = calculerTotaux([{ prixUnitaireCents: 1001, quantite: 1, groupe: 'B' }], 'ttc');
      expect(t.groupes[0]).toMatchObject({ baseCents: 863, tvaCents: 138, totalCents: 1001 });
    });

    it("EXACTEMENT l'e-MCF de test de la DGI (vente réelle du 07/11/2026) : 2 000,00 en B → base 1 724,14, TVA 275,86", () => {
      const t = calculerTotaux([{ prixUnitaireCents: 200000, quantite: 1, groupe: 'B' }, { prixUnitaireCents: 300000, quantite: 1, groupe: 'A' }], 'ttc');
      expect(t.groupes).toEqual([
        { groupe: 'A', taux: 0, totalCents: 300000, baseCents: 300000, tvaCents: 0 },
        { groupe: 'B', taux: 16, totalCents: 200000, baseCents: 172414, tvaCents: 27586 },
      ]);
      expect(t.tvaCents).toBe(27586);
      expect(t.totalCents).toBe(500000);
    });

    it('cas de test n° 1 : 1 × B et 1 × C — un total par groupe, base + TVA = total', () => {
      const t = calculerTotaux(
        [
          { prixUnitaireCents: 11600, quantite: 1, groupe: 'B' },
          { prixUnitaireCents: 1050, quantite: 1, groupe: 'C' },
        ],
        'ttc',
      );
      expect(t.groupes.map((g) => [g.groupe, g.baseCents, g.tvaCents])).toEqual([
        ['B', 10000, 1600],
        ['C', 1000, 50],
      ]);
      expect(t.totalCents).toBe(12650);
      expect(t.tvaCents).toBe(1650);
      for (const g of t.groupes) expect(g.baseCents + g.tvaCents).toBe(g.totalCents);
    });

    it('cas de test n° 4 : 2,375 × B et 3,5 × A (exonéré, pas de TVA)', () => {
      const t = calculerTotaux(
        [
          { prixUnitaireCents: 1000, quantite: '2.375', groupe: 'B' },
          { prixUnitaireCents: 1234, quantite: '3.5', groupe: 'A' },
        ],
        'ttc',
      );
      const a = t.groupes.find((g) => g.groupe === 'A')!;
      const b = t.groupes.find((g) => g.groupe === 'B')!;
      expect(a).toEqual({ groupe: 'A', taux: 0, totalCents: 4319, baseCents: 4319, tvaCents: 0 });
      expect(b.totalCents).toBe(2375);
      expect(b.baseCents + b.tvaCents).toBe(2375);
      expect(t.totalCents).toBe(2375 + 4319);
      expect(t.montantsLignes).toEqual([2375, 4319]);
    });

    it('les groupes sont rangés de A à P, quel que soit l’ordre des articles', () => {
      const t = calculerTotaux(
        [
          { prixUnitaireCents: 500, quantite: 1, groupe: 'O' },
          { prixUnitaireCents: 500, quantite: 1, groupe: 'K' },
          { prixUnitaireCents: 500, quantite: 1, groupe: 'B' },
        ],
        'ttc',
      );
      expect(t.groupes.map((g) => g.groupe)).toEqual(['B', 'K', 'O']);
    });

    it('cas de test n° 8 : la taxe spécifique entre dans la base de la TVA et la supporte (1.5.10)', () => {
      const t = calculerTotaux([{ prixUnitaireCents: 1160, quantite: 3, groupe: 'B', taxeSpecifiqueCents: 300 }], 'ttc');
      // prix TTC 3 480 = 3 000 HT + 480 de TVA ; + 300 de taxe spécifique dans la base, taxée à 16 % (48).
      expect(t.groupes[0]).toMatchObject({ totalCents: 3828, baseCents: 3300, tvaCents: 528 });
      expect(t.taxeSpecifiqueCents).toBe(300);
    });

    it('cas de test n° 8 : exactement les montants de l’e-MCF de test de la DGI (3 × B, 2 × C, 1 × A, taxe 500 et 200 par unité)', () => {
      const t = calculerTotaux(
        [
          { prixUnitaireCents: 1160000, quantite: 3, groupe: 'B', taxeSpecifiqueCents: 150000 },
          { prixUnitaireCents: 525000, quantite: 2, groupe: 'C', taxeSpecifiqueCents: 40000 },
          { prixUnitaireCents: 250000, quantite: 1, groupe: 'A' },
        ],
        'ttc',
      );
      // Réponse de la DGI : tab 36540 hab 31500 vab 5040 · tac 10920 hac 10400 vac 520 · total 49960 vtotal 5560.
      expect(t.groupes.map((g) => [g.groupe, g.totalCents, g.baseCents, g.tvaCents])).toEqual([
        ['A', 250000, 250000, 0],
        ['B', 3654000, 3150000, 504000],
        ['C', 1092000, 1040000, 52000],
      ]);
      expect(t.totalCents).toBe(4996000);
      expect(t.tvaCents).toBe(556000);
    });

    it('TTC et HT donnent la même facture quand les prix sont équivalents (taxe spécifique comprise)', () => {
      const ttc = calculerTotaux([{ prixUnitaireCents: 11600, quantite: 3, groupe: 'B', taxeSpecifiqueCents: 300 }], 'ttc');
      const ht = calculerTotaux([{ prixUnitaireCents: 10000, quantite: 3, groupe: 'B', taxeSpecifiqueCents: 300 }], 'ht');
      expect(ttc.groupes[0]).toEqual(ht.groupes[0]);
    });

    it('groupe N : tout le montant est de la TVA (1.5.8)', () => {
      const t = calculerTotaux(
        [
          { prixUnitaireCents: 5000, quantite: 3, groupe: 'M' },
          { prixUnitaireCents: 800, quantite: 3, groupe: 'N' },
        ],
        'ttc',
      );
      expect(t.groupes.find((g) => g.groupe === 'M')).toMatchObject({ tvaCents: 0, totalCents: 15000 });
      expect(t.groupes.find((g) => g.groupe === 'N')).toMatchObject({ taux: 100, baseCents: 0, tvaCents: 2400, totalCents: 2400 });
      expect(t.tvaCents).toBe(2400);
    });

    it('groupe O (1 %, nouveau en 2026)', () => {
      const t = calculerTotaux([{ prixUnitaireCents: 10100, quantite: 1, groupe: 'O' }], 'ttc');
      expect(t.groupes[0]).toMatchObject({ taux: 1, baseCents: 10000, tvaCents: 100 });
    });
  });

  describe('mode HT : le total se déduit de la base, la TVA est arrondie au centime le plus proche', () => {
    it('8,62 HT en B → TVA 1,38 (1,3792), total 10,00', () => {
      const t = calculerTotaux([{ prixUnitaireCents: 862, quantite: 1, groupe: 'B' }], 'ht');
      expect(t.groupes[0]).toEqual({ groupe: 'B', taux: 16, totalCents: 1000, baseCents: 862, tvaCents: 138 });
    });

    it('100,00 HT en B et 100,00 HT en C', () => {
      const t = calculerTotaux(
        [
          { prixUnitaireCents: 10000, quantite: 1, groupe: 'B' },
          { prixUnitaireCents: 10000, quantite: 1, groupe: 'C' },
        ],
        'ht',
      );
      expect(t.totalCents).toBe(11600 + 10500);
      expect(t.tvaCents).toBe(1600 + 500);
    });

    it('la taxe spécifique augmente la base HT', () => {
      const t = calculerTotaux([{ prixUnitaireCents: 1000, quantite: 3, groupe: 'B', taxeSpecifiqueCents: 300 }], 'ht');
      expect(t.groupes[0]).toMatchObject({ baseCents: 3300, tvaCents: 528, totalCents: 3828 });
    });
  });

  it('refuse une facture vide', () => {
    expect(() => calculerTotaux([], 'ttc')).toThrow();
  });

  describe('dollars (1.1.30) : facture en CDF, équivalent en USD, taux à 1 % du taux de la BCC', () => {
    it('convertit au centime près', () => {
      expect(usdVersCdf(1000, '2850.5')).toBe(2850500); // 10 $ → 28 505,00 CDF
      expect(cdfVersUsd(2850500, '2850.5')).toBe(1000);
      expect(usdVersCdf(1, '2850.55')).toBe(2851); // 0,01 $ → 28,5055 → 28,51
    });

    it('accepte un taux à 1 % près du taux de référence, refuse au-delà', () => {
      expect(tauxDansLaMarge('2878', '2850')).toBe(true); // 0,98 %
      expect(tauxDansLaMarge('2822', '2850')).toBe(true); // -0,98 %
      expect(tauxDansLaMarge('2880', '2850')).toBe(false); // 1,05 %
      expect(() => tauxDansLaMarge('abc', '2850')).toThrow();
    });
  });

  it('numérote par année de gestion', () => {
    expect(numeroFacture(2026, 123)).toBe('2026/000123');
    expect(numeroFacture(2027, 1)).toBe('2027/000001');
  });
});
