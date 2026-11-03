import { contenuRapportA, contenuRapportXZ, FacturePourRapport } from './rapports';

const fv = (total: number, tva: number, groupes: any[], paiements: any[], extra: Partial<FacturePourRapport> = {}): FacturePourRapport => ({
  invoice_type: 'FV',
  status: 'confirmed',
  total_cents: total,
  vat_cents: tva,
  computed_totals: { groupes, taxeSpecifiqueCents: 0 },
  payments: paiements,
  ...extra,
});

describe('Rapports X et Z (1.3.3)', () => {
  const factures: FacturePourRapport[] = [
    fv(11600, 1600, [{ groupe: 'B', taux: 16, totalCents: 11600, baseCents: 10000, tvaCents: 1600 }], [{ moyen: 'ESPECES', montantCents: 11600 }]),
    fv(
      12650,
      1650,
      [
        { groupe: 'B', taux: 16, totalCents: 11600, baseCents: 10000, tvaCents: 1600 },
        { groupe: 'C', taux: 5, totalCents: 1050, baseCents: 1000, tvaCents: 50 },
      ],
      [
        { moyen: 'ESPECES', montantCents: 6000 },
        { moyen: 'MOBILEMONEY', montantCents: 6650 },
      ],
      { lignesRemisees: [{ quantite: '2', prixUnitaireCents: 900, prixOrigineCents: 1000 }] },
    ),
    {
      invoice_type: 'FA',
      status: 'confirmed',
      total_cents: 11600,
      vat_cents: 1600,
      reference_type: 'RAM',
      computed_totals: { groupes: [{ groupe: 'B', taux: 16, totalCents: 11600, baseCents: 10000, tvaCents: 1600 }] },
      payments: [{ moyen: 'ESPECES', montantCents: 11600 }],
    },
    { invoice_type: 'FV', status: 'provisional', total_cents: 5000, vat_cents: 0 },
    { invoice_type: 'FV', status: 'failed', total_cents: 5000, vat_cents: 0 },
  ];

  const r = contenuRapportXZ(factures, [
    { type: 'cash_in', amount_cents: 50000, currency: 'CDF' },
    { type: 'cash_out', amount_cents: 20000, currency: 'CDF' },
    { type: 'cash_in', amount_cents: 1000, currency: 'USD' },
  ]);

  it('totaux et nombre de factures par type, avec le détail par groupe', () => {
    expect(r.parType.map((t) => [t.type, t.nombre, t.totalCents, t.baseCents, t.tvaCents])).toEqual([
      ['FV', 2, 24250, 21000, 3250],
      ['FA', 1, 11600, 10000, 1600],
    ]);
    expect(r.parType[0].groupes).toEqual([
      { groupe: 'B', taux: 16, totalCents: 23200, baseCents: 20000, tvaCents: 3200 },
      { groupe: 'C', taux: 5, totalCents: 1050, baseCents: 1000, tvaCents: 50 },
    ]);
  });

  it('ventes, avoirs et net', () => {
    expect(r.ventes).toEqual({ nombre: 2, totalCents: 24250, tvaCents: 3250 });
    expect(r.avoirs).toEqual({ nombre: 1, totalCents: 11600, tvaCents: 1600 });
    expect(r.net).toEqual({ totalCents: 12650, tvaCents: 1650 });
  });

  it('paiements par mode (encaissés) et remboursements (avoirs) séparés', () => {
    expect(r.paiements).toEqual([
      { moyen: 'ESPECES', totalCents: 17600 },
      { moyen: 'MOBILEMONEY', totalCents: 6650 },
    ]);
    expect(r.remboursements).toEqual([{ moyen: 'ESPECES', totalCents: 11600 }]);
  });

  it('réductions commerciales, ventes incomplètes, dépôts et retraits d’espèces', () => {
    expect(r.reductions).toEqual({ lignes: 1, montantCents: 200, remisesRrrCents: 0 });
    expect(r.incompletes).toEqual({ nombre: 2, provisoires: 1, enEchec: 1 });
    expect(r.especes).toEqual([
      { devise: 'CDF', depotsCents: 50000, retraitsCents: 20000 },
      { devise: 'USD', depotsCents: 1000, retraitsCents: 0 },
    ]);
  });

  it('un rapport sans facture est vide mais complet', () => {
    const vide = contenuRapportXZ([]);
    expect(vide.ventes).toEqual({ nombre: 0, totalCents: 0, tvaCents: 0 });
    expect(vide.parType).toEqual([]);
    expect(vide.incompletes.nombre).toBe(0);
  });
});

describe('Rapport A (articles, 1.4)', () => {
  it('quantités vendues et retournées par article et par prix, avec le stock actuel', () => {
    const a = contenuRapportA(
      [
        { invoice_type: 'FV', stock_item_id: 's1', code: '6001', name: 'Riz 25 kg', tax_group: 'B', unit_price_cents: 11600, quantity: '2', line_total_cents: 23200 },
        { invoice_type: 'FV', stock_item_id: 's1', code: '6001', name: 'Riz 25 kg', tax_group: 'B', unit_price_cents: 11600, quantity: '1', line_total_cents: 11600 },
        { invoice_type: 'FA', stock_item_id: 's1', code: '6001', name: 'Riz 25 kg', tax_group: 'B', unit_price_cents: 11600, quantity: '1', line_total_cents: 11600 },
        { invoice_type: 'FV', stock_item_id: 's2', code: null, name: 'Farine', tax_group: 'C', unit_price_cents: 1050, quantity: '2.375', line_total_cents: 2494 },
      ],
      { s1: 40, s2: 12.5 },
    );
    expect(a).toEqual([
      { code: null, nom: 'Farine', groupe: 'C', taux: 5, prixUnitaireCents: 1050, vendu: '2.375', retourne: '0', montantVenduCents: 2494, montantRetourneCents: 0, enStock: 12.5 },
      { code: '6001', nom: 'Riz 25 kg', groupe: 'B', taux: 16, prixUnitaireCents: 11600, vendu: '3', retourne: '1', montantVenduCents: 34800, montantRetourneCents: 11600, enStock: 40 },
    ]);
  });
});
