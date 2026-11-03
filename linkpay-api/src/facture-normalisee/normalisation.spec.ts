import { FauxEmcf } from '../test-utils/faux-emcf';
import { EchangeEmcf, EmcfClient } from './emcf.client';
import { GROUPES_HOMOLOGUES } from './groupes';
import { normaliser } from './normalisation';
import { comparerMontants, construireRequete } from './requete';
import { FactureAEmettre, validerFacture } from './validation';

const facture = (f: Partial<FactureAEmettre> = {}): FactureAEmettre => ({
  type: 'FV',
  mode: 'ttc',
  articles: [
    { nom: 'Riz 25 kg', type: 'BIE', groupe: 'B', code: '6001234', prixUnitaireCents: 11600, quantite: '2' },
    { nom: 'Farine', type: 'BIE', groupe: 'C', prixUnitaireCents: 1050, quantite: '3.5' },
    { nom: 'Médicament', type: 'BIE', groupe: 'A', prixUnitaireCents: 5000, quantite: 1 },
  ],
  client: { type: 'PM', nom: 'SUPERMARCHÉ SARL', nif: 'A2216742Y' },
  paiements: [],
  groupesAutorises: GROUPES_HOMOLOGUES,
  ...f,
});

let rnSuivant = 1;
const preparer = (f: FactureAEmettre) => {
  const v = validerFacture(f);
  if (!v.ok) throw new Error(v.erreurs.join(' ; '));
  const requete = construireRequete(f, {
    nif: 'A2216742Y',
    rn: `2026/${String(rnSuivant++).padStart(6, '0')}`,
    isf: 'SLP-SFE-01',
    operateur: { id: 'u1', nom: 'Jacques' },
  });
  return { requete, totaux: v.totaux };
};

describe('Normalisation avec l’e-MCF (faux serveur qui suit le protocole v1.3)', () => {
  let dgi: FauxEmcf;
  let racine: string;
  let journal: EchangeEmcf[];
  const client = (jeton = 'jeton-de-test', delaiMs = 400) =>
    new EmcfClient({ environnement: 'test', jeton, racine, delaiMs, journaliser: (e) => void journal.push(e) });

  beforeEach(async () => {
    dgi = new FauxEmcf();
    racine = await dgi.demarrer();
    journal = [];
  });
  afterEach(() => dgi.arreter());

  it('envoie, compare, confirme : la facture reçoit son code DEF/DGI et son QR', async () => {
    const { requete, totaux } = preparer(facture());
    const issue = await normaliser(client(), requete, totaux);
    expect(issue.statut).toBe('confirmee');
    if (issue.statut !== 'confirmee') return;
    expect(issue.elements.codeDEFDGI).toHaveLength(29);
    expect(issue.elements.qrCode).toMatch(/^RDCDEF01;/);
    expect(dgi.finalisees).toHaveLength(1);
    expect(dgi.enAttente.size).toBe(0);
    // Chaque échange est journalisé, sans le jeton.
    expect(journal.map((e) => e.operation)).toEqual(['invoice', 'confirm']);
    expect(JSON.stringify(journal)).not.toContain('jeton-de-test');
  });

  it('montants différents de ceux de la DGI : la demande est annulée, aucune facture émise', async () => {
    dgi.alterer = (t) => {
      t.vab += 0.01;
      t.vtotal += 0.01;
    };
    const { requete, totaux } = preparer(facture());
    const issue = await normaliser(client(), requete, totaux);
    expect(issue.statut).toBe('ecart');
    if (issue.statut !== 'ecart') return;
    expect(issue.ecarts.map((e) => e.champ)).toEqual(['vab', 'vtotal']);
    expect(dgi.finalisees).toHaveLength(0);
    expect(dgi.annulees).toHaveLength(1);
  });

  it('réponse perdue après la demande : retrouve la demande en attente, aucun doublon', async () => {
    dgi.perdreReponse.add('invoice');
    const { requete, totaux } = preparer(facture());
    const issue = await normaliser(client(), requete, totaux);
    expect(issue.statut).toBe('confirmee');
    expect(dgi.finalisees).toHaveLength(1);
    expect(journal.map((e) => e.operation)).toEqual(['invoice', 'status', 'details', 'confirm']);
    expect(journal[0].error).toBe('délai dépassé');
  });

  it('reprend une demande déjà en attente grâce à son uid', async () => {
    dgi.perdreReponse.add('invoice');
    const { requete, totaux } = preparer(facture());
    await client().demanderFacture(requete).catch(() => undefined);
    const [uid] = [...dgi.enAttente.keys()];
    const issue = await normaliser(client(), requete, totaux, { uidEnAttente: uid });
    expect(issue.statut).toBe('confirmee');
    expect(dgi.finalisees).toHaveLength(1);
  });

  it('confirmation perdue : nouvel essai, puis « à vérifier » si la DGI dit qu’elle est déjà finalisée', async () => {
    dgi.perdreReponse.add('confirm');
    const { requete, totaux } = preparer(facture());
    const issue = await normaliser(client(), requete, totaux);
    expect(issue.statut).toBe('a_verifier');
    expect(dgi.finalisees).toHaveLength(1); // une seule facture côté DGI
  });

  it('DGI injoignable : bon provisoire, rien n’est perdu', async () => {
    await dgi.arreter();
    const { requete, totaux } = preparer(facture());
    const issue = await normaliser(client(), requete, totaux);
    expect(issue.statut).toBe('injoignable');
  });

  it('jeton refusé : message clair pour créer un nouveau jeton', async () => {
    const { requete, totaux } = preparer(facture());
    const issue = await normaliser(client('mauvais-jeton'), requete, totaux);
    expect(issue.statut).toBe('refusee');
    if (issue.statut === 'refusee') {
      expect(issue.erreur.genre).toBe('jeton');
      expect(issue.erreur.message).toContain('portail e-DEF');
    }
  });

  it('refus de la DGI : son code et sa description sont remontés au caissier', async () => {
    dgi.refus = { code: '12', desc: "Le montant de l'avoir dépasse celui de la facture d'origine" };
    const { requete, totaux } = preparer(facture());
    const issue = await normaliser(client(), requete, totaux);
    expect(issue.statut).toBe('refusee');
    if (issue.statut === 'refusee') {
      expect(issue.erreur.code).toBe('12');
      expect(issue.erreur.message).toContain("dépasse celui de la facture d'origine");
    }
  });

  it('mode HT, quantités décimales, remise et paiement mixte : la DGI et nous trouvons les mêmes montants', async () => {
    const f = facture({
      mode: 'ht',
      articles: [
        { nom: 'Viande', type: 'BIE', groupe: 'B', prixUnitaireCents: 862, quantite: '2.375', prixOrigineCents: 958, modificationPrix: 'Remise 10 %' },
        { nom: 'Casier consigné', type: 'BIE', groupe: 'H', prixUnitaireCents: 3000, quantite: 2 },
        { nom: 'Sucre', type: 'BIE', groupe: 'O', prixUnitaireCents: 1999, quantite: 3 },
      ],
    });
    const v = validerFacture(f);
    if (!v.ok) throw new Error(v.erreurs.join());
    const total = v.totaux.totalCents;
    const { requete, totaux } = preparer({
      ...f,
      paiements: [
        { moyen: 'ESPECES', montantCents: 1000 },
        { moyen: 'MOBILEMONEY', montantCents: total - 1000 },
      ],
    });
    expect(await normaliser(client(), requete, totaux)).toMatchObject({ statut: 'confirmee' });
  });
});

describe('La demande envoyée à la DGI (InvoiceRequestDataDto)', () => {
  it('porte tous les champs du protocole, au bon format', () => {
    const r = construireRequete(
      facture({
        type: 'FA',
        avoir: { nature: 'RAM', referenceCode: 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX' },
        client: { type: 'AO', nom: 'Ambassade', referenceExoneration: 'EXO 56/2025' },
        paiements: [{ moyen: 'ESPECES', montantCents: 28505, devise: 'USD', taux: '2850.5' }],
        commentaires: ['Merci de votre visite'],
      }),
      { nif: 'A2216742Y', rn: '2026/000009', isf: 'SLP-SFE-01', operateur: { id: 'u1', nom: 'Jacques' }, devise: { code: 'USD', taux: '2850.5', date: new Date('2026-11-03T11:44:55Z') } },
    );
    expect(r).toMatchObject({
      nif: 'A2216742Y',
      rn: '2026/000009',
      mode: 'ttc',
      isf: 'SLP-SFE-01',
      type: 'FA',
      reference: 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX',
      referenceType: 'RAM',
      referenceDesc: 'Avoir suite reprise',
      cmta: 'Réf. Exo. : EXO 56/2025',
      cmtb: 'Merci de votre visite',
      curCode: 'USD',
      curDate: '2026-11-03 12:44:55',
      curRate: 2850.5,
      operator: { id: 'u1', name: 'Jacques' },
      client: { type: 'AO', typeDesc: 'Ambassades et organisations internationales', name: 'Ambassade' },
      payment: [{ name: 'ESPECES', amount: 285.05, currencyCode: 'USD', currencyRate: 2850.5 }],
    });
    expect((r.items as any[])[0]).toEqual({ type: 'BIE', name: 'Riz 25 kg', code: '6001234', price: 116, quantity: 2, taxGroup: 'B' });
    expect((r.items as any[])[1]).toMatchObject({ price: 10.5, quantity: 3.5, taxGroup: 'C' });
  });

  it('une remise RRR porte la référence « RRR »', () => {
    const r = construireRequete(facture({ type: 'FA', avoir: { nature: 'RRR' } }), {
      nif: 'A2216742Y',
      rn: '2026/000010',
      isf: 'SLP-SFE-01',
      operateur: { nom: 'Jacques' },
    });
    expect(r.reference).toBe('RRR');
  });

  it('repère le moindre centime d’écart, et un groupe que la DGI aurait oublié', () => {
    const v = validerFacture(facture());
    if (!v.ok) throw new Error();
    const dgi: any = { uid: 'x', total: v.totaux.totalCents / 100, vtotal: v.totaux.tvaCents / 100 };
    for (const g of v.totaux.groupes) {
      const x = g.groupe.toLowerCase();
      dgi[`ta${x}`] = g.totalCents / 100;
      dgi[`ha${x}`] = g.baseCents / 100;
      dgi[`va${x}`] = g.tvaCents / 100;
    }
    expect(comparerMontants(v.totaux, dgi)).toEqual([]);
    expect(comparerMontants(v.totaux, { ...dgi, total: dgi.total + 0.01 })).toEqual([expect.objectContaining({ champ: 'total' })]);
    const sansC = { ...dgi };
    delete sansC.tac;
    expect(comparerMontants(v.totaux, sansC).map((e) => e.champ)).toEqual(['tac']);
  });
});
