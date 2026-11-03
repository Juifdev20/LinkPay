import { GROUPES_HOMOLOGUES } from './groupes';
import { FactureAEmettre, validerFacture, verifierAvoir } from './validation';

const base = (f: Partial<FactureAEmettre> = {}): FactureAEmettre => ({
  type: 'FV',
  mode: 'ttc',
  articles: [{ nom: 'Riz 25 kg', type: 'BIE', groupe: 'B', prixUnitaireCents: 11600, quantite: 1 }],
  client: { type: 'PP' },
  paiements: [{ moyen: 'ESPECES', montantCents: 11600 }],
  groupesAutorises: GROUPES_HOMOLOGUES,
  ...f,
});

const erreurs = (f: FactureAEmettre) => {
  const r = validerFacture(f);
  return r.ok ? [] : r.erreurs;
};

describe('Facture normalisée — règles vérifiées avant l’envoi à la DGI', () => {
  it('accepte une vente simple à un particulier et renvoie les totaux', () => {
    const r = validerFacture(base());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.totaux.totalCents).toBe(11600);
  });

  it('sans paiement indiqué, le paiement est en espèces (comme pour l’e-MCF)', () => {
    expect(validerFacture(base({ paiements: [] })).ok).toBe(true);
  });

  it('client personne morale : nom et NIF obligatoires, NIF de 9 caractères', () => {
    expect(erreurs(base({ client: { type: 'PM' } }))).toEqual(
      expect.arrayContaining([expect.stringContaining('nom est obligatoire'), expect.stringContaining('NIF est obligatoire')]),
    );
    expect(erreurs(base({ client: { type: 'PM', nom: 'SUPERMARCHÉ SARL', nif: 'A22' } }))).toEqual([
      expect.stringContaining('9 caractères'),
    ]);
    expect(erreurs(base({ client: { type: 'PM', nom: 'SUPERMARCHÉ SARL', nif: 'A2216742Y' } }))).toEqual([]);
  });

  it("client AO : la référence du certificat d'exonération est obligatoire", () => {
    expect(erreurs(base({ client: { type: 'AO', nom: 'Ambassade' } }))[0]).toContain("certificat d'exonération");
  });

  it('refuse un groupe non autorisé pour l’entreprise, TAX hors L/N, HORS CHAMP hors A, E hors export', () => {
    expect(erreurs(base({ articles: [{ nom: 'X', type: 'BIE', groupe: 'F', prixUnitaireCents: 100, quantite: 1 }], paiements: [] }))[0]).toContain(
      "n'est pas autorisé",
    );
    expect(erreurs(base({ articles: [{ nom: 'X', type: 'TAX', groupe: 'B', prixUnitaireCents: 100, quantite: 1 }], paiements: [] }))[0]).toContain(
      'TAX seulement',
    );
    expect(
      erreurs(base({ articles: [{ nom: 'X', type: 'SER', groupe: 'B', code: 'HORS CHAMP', prixUnitaireCents: 100, quantite: 1 }], paiements: [] }))[0],
    ).toContain('HORS CHAMP');
    expect(erreurs(base({ articles: [{ nom: 'X', type: 'BIE', groupe: 'E', prixUnitaireCents: 100, quantite: 1 }], paiements: [] }))[0]).toContain(
      'exportation',
    );
    expect(
      erreurs(base({ type: 'EV', articles: [{ nom: 'Cuivre', type: 'BIE', groupe: 'E', prixUnitaireCents: 100, quantite: 3 }], paiements: [] })),
    ).toEqual([]);
  });

  it('une remise demande le prix d’origine (plus élevé) et son motif', () => {
    const remise = { nom: 'Huile', type: 'BIE' as const, groupe: 'B' as const, prixUnitaireCents: 900, quantite: 2 };
    expect(erreurs(base({ articles: [{ ...remise, prixOrigineCents: 1000 }], paiements: [] }))[0]).toContain('motif');
    expect(erreurs(base({ articles: [{ ...remise, prixOrigineCents: 800, modificationPrix: 'Remise' }], paiements: [] }))[0]).toContain(
      "prix d'origine",
    );
    expect(erreurs(base({ articles: [{ ...remise, prixOrigineCents: 1000, modificationPrix: 'Remise 10 %' }], paiements: [] }))).toEqual([]);
  });

  it('le total des paiements doit être égal au total de la facture (paiements multiples et USD)', () => {
    expect(erreurs(base({ paiements: [{ moyen: 'ESPECES', montantCents: 10000 }] }))[0]).toContain('doit être égal');
    expect(
      erreurs(
        base({
          paiements: [
            { moyen: 'ESPECES', montantCents: 6000 },
            { moyen: 'MOBILEMONEY', montantCents: 5600 },
          ],
        }),
      ),
    ).toEqual([]);
    expect(erreurs(base({ paiements: [{ moyen: 'ESPECES', montantCents: 11600, devise: 'USD' }] }))[0]).toContain('taux de change');
  });

  it('un avoir exige sa nature et la référence de la facture d’origine (sauf remise RRR)', () => {
    expect(erreurs(base({ type: 'FA' }))[0]).toContain("nature de l'avoir");
    expect(erreurs(base({ type: 'FA', avoir: { nature: 'RAM' } }))[0]).toContain('code DEF/DGI');
    expect(erreurs(base({ type: 'FA', avoir: { nature: 'RAM', referenceCode: 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX' } }))).toEqual([]);
    expect(erreurs(base({ type: 'FA', avoir: { nature: 'RRR' } }))).toEqual([]);
    expect(erreurs(base({ type: 'FV', avoir: { nature: 'RRR' } }))[0]).toContain("facture d'avoir");
  });
});

describe('Avoirs : mêmes articles, même prix, quantités cumulées ≤ quantités vendues (1.1.26)', () => {
  const origine = [
    { id: 'l1', prixUnitaireCents: 11600, quantite: '3', groupe: 'B' as const },
    { id: 'l2', prixUnitaireCents: 1050, quantite: '2.5', groupe: 'C' as const },
  ];
  const ligne = (id: string, q: string, prix = 11600, groupe: 'B' | 'C' = 'B') => ({
    nom: id,
    type: 'BIE' as const,
    groupe,
    prixUnitaireCents: prix,
    quantite: q,
    ligneOrigineId: id,
  });

  it('accepte un remboursement partiel puis un second jusqu’à la quantité vendue', () => {
    expect(verifierAvoir(origine, {}, [ligne('l1', '2')])).toEqual([]);
    expect(verifierAvoir(origine, { l1: '2' }, [ligne('l1', '1')])).toEqual([]);
    expect(verifierAvoir(origine, {}, [ligne('l2', '2.5', 1050, 'C')])).toEqual([]);
  });

  it('refuse de rembourser plus que vendu, même en plusieurs avoirs', () => {
    expect(verifierAvoir(origine, { l1: '2' }, [ligne('l1', '1.001')])[0]).toContain('il reste 1');
    expect(verifierAvoir(origine, {}, [ligne('l1', '2'), ligne('l1', '2')])[0]).toContain('trop grande');
  });

  it('refuse un autre prix, un autre groupe ou un article absent de la facture d’origine', () => {
    expect(verifierAvoir(origine, {}, [ligne('l1', '1', 10000)])[0]).toContain('prix');
    expect(verifierAvoir(origine, {}, [ligne('l1', '1', 11600, 'C')])[0]).toContain('groupe');
    expect(verifierAvoir(origine, {}, [ligne('lx', '1')])[0]).toContain("n'existe pas");
  });
});
