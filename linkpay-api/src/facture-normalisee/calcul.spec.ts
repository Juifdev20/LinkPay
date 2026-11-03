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

  describe('mode TTC : la base se déduit du total du groupe, la taxe est arrondie vers le haut', () => {
    it('116,00 en B (16 %) → base 100,00, TVA 16,00', () => {
      const t = calculerTotaux([{ prixUnitaireCents: 11600, quantite: 1, groupe: 'B' }], 'ttc');
      expect(t.groupes).toEqual([{ groupe: 'B', taux: 16, totalCents: 11600, baseCents: 10000, tvaCents: 1600 }]);
      expect(t.totalCents).toBe(11600);
      expect(t.tvaCents).toBe(1600);
    });

    it("en cas d'arrondi, c'est la TVA qui monte (10,01 → base 8,62, TVA 1,39)", () => {
      const t = calculerTotaux([{ prixUnitaireCents: 1001, quantite: 1, groupe: 'B' }], 'ttc');
      expect(t.groupes[0]).toMatchObject({ baseCents: 862, tvaCents: 139, totalCents: 1001 });
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

    it('cas de test n° 8 : la taxe spécifique entre dans la base de la TVA (1.5.10)', () => {
      const t = calculerTotaux([{ prixUnitaireCents: 1160, quantite: 3, groupe: 'B', taxeSpecifiqueCents: 300 }], 'ttc');
      expect(t.groupes[0]).toMatchObject({ totalCents: 3780, baseCents: 3258, tvaCents: 522 });
      expect(t.taxeSpecifiqueCents).toBe(300);
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

  describe('mode HT : le total se déduit de la base, la taxe est arrondie vers le haut', () => {
    it('8,62 HT en B → TVA 1,38 (1,3792 arrondi vers le haut), total 10,00', () => {
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
