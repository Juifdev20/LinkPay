import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../supabase/supabase.service';
import { cdfVersUsd, ModePrix, numeroFacture, tauxDansLaMarge, TotauxFacture } from './calcul';
import { EmcfClient, EnvironnementEmcf, ErreurEmcf, StatutEmcf } from './emcf.client';
import { estAvoir, GroupeTaxation, GROUPES_HOMOLOGUES } from './groupes';
import { JetonFiscalService } from './jeton-fiscal.service';
import { IssueNormalisation, normaliser } from './normalisation';
import { construireRequete } from './requete';
import { ArticleFacture, FactureAEmettre, validerFacture, verifierAvoir } from './validation';

export interface ProfilFiscal {
  organization_id: string;
  enabled: boolean;
  nif: string | null;
  vat_regime: 'assujetti' | 'non_assujetti';
  price_mode: 'ttc' | 'ht';
  default_tax_group: GroupeTaxation | null;
  allowed_tax_groups: GroupeTaxation[];
  emcf_environment: EnvironnementEmcf;
  emcf_token_encrypted: string | null;
  emcf_token_hint: string | null;
  emcf_nim: string | null;
}

export type SourceFacture = { type: 'pos_ticket' | 'sale' | 'hotel' | 'manual'; id?: string };

export interface DemandeEmission {
  organizationId: string;
  merchantId?: string | null;
  source: SourceFacture;
  facture: Omit<FactureAEmettre, 'mode' | 'groupesAutorises'>;
  operateur: { id?: string; nom: string };
  userId?: string | null;
  /** Avoir : la facture normalisée d'origine (sauf remise RRR). */
  factureOrigineId?: string;
  /** Équivalent en USD affiché sur la facture. */
  devise?: { code: 'USD'; taux: string; date?: Date };
  /** Mode imposé (une vente ScanLinkPay est toujours en TTC) ; sinon celui du profil. */
  mode?: ModePrix;
}

/** Ce que l'API renvoie d'une facture : jamais le jeton, jamais le détail du journal. */
export interface VueFacture {
  id: string;
  rn: string;
  invoice_type: string;
  status: string;
  total_cents: number | null;
  vat_cents: number | null;
  code_def_dgi: string | null;
  qr_code: string | null;
  counters: string | null;
  nim: string | null;
  emcf_datetime: string | null;
  last_error_code: string | null;
  last_error_desc: string | null;
}

const COLONNES_VUE =
  'id, rn, invoice_type, status, total_cents, vat_cents, code_def_dgi, qr_code, counters, nim, emcf_datetime, last_error_code, last_error_desc';

/** Une demande « en attente » sans nouvelles depuis plus longtemps que ça est reprise (l'e-MCF l'expire à 2 min). */
const ATTENTE_BLOQUEE_MS = 3 * 60 * 1000;

/**
 * Un jeton (JWT) ne contient jamais d'espace ni de retour à la ligne : le portail l'affiche sur plusieurs lignes, et un
 * copier-coller peut en laisser passer. On les retire, ainsi que « Bearer » et les guillemets éventuels.
 */
export const nettoyerJeton = (jeton: string | null | undefined) => (jeton ?? '').replace(/^\s*bearer\s+/i, '').replace(/["'\s]+/g, '');

/** Année de gestion à Kinshasa (UTC+1). */
export const anneeDeGestion = (d = new Date()) => new Date(d.getTime() + 60 * 60 * 1000).getUTCFullYear();

/**
 * La facture normalisée côté serveur : profil fiscal et jeton, émission (validation → numéro → demande à l'e-MCF →
 * comparaison → confirmation), reprise automatique des bons provisoires. Le jeton ne quitte jamais ce service.
 * Voir docs/FACTURE_NORMALISEE.md.
 */
@Injectable()
export class FactureNormaliseeService {
  private readonly logger = new Logger(FactureNormaliseeService.name);

  constructor(
    private supabase: SupabaseService,
    private config: ConfigService,
    private jetons: JetonFiscalService,
  ) {}

  private get db() {
    return this.supabase.getClient();
  }

  /** ISF de ScanLinkPay (donné par la DGI à l'homologation, le même pour tous nos clients). */
  isf(environnement: EnvironnementEmcf): string {
    const isf = (this.config.get<string>('EMCF_ISF') ?? '').trim();
    if (isf) return isf;
    if (environnement === 'production') {
      throw new BadRequestException("ScanLinkPay n'a pas encore d'ISF de production (homologation DGI en cours)");
    }
    return 'SLP-SFE-01'; // libre en test, au format AAA-BBB-NN
  }

  async profil(organizationId: string): Promise<ProfilFiscal | null> {
    const { data, error } = await this.db.from('fiscal_profiles').select('*').eq('organization_id', organizationId).maybeSingle();
    if (error) throw new BadRequestException(`Profil fiscal illisible : ${error.message}`);
    return (data as ProfilFiscal) ?? null;
  }

  /** Client e-MCF de l'entreprise (jeton déchiffré ici seulement), chaque échange journalisé. */
  clientEmcf(profil: ProfilFiscal, factureId: string | null): EmcfClient {
    if (!profil.emcf_token_encrypted) throw new ErreurEmcf('jeton', "Aucun jeton e-MCF n'est enregistré pour cette entreprise");
    const env = profil.emcf_environment;
    const racine = this.config.get<string>(env === 'production' ? 'EMCF_RACINE_PRODUCTION' : 'EMCF_RACINE_TEST') || undefined;
    return new EmcfClient({
      environnement: env,
      racine,
      jeton: this.jetons.dechiffrer(profil.emcf_token_encrypted),
      journaliser: async (e) => {
        const { error } = await this.db.from('emcf_exchanges').insert({
          organization_id: profil.organization_id,
          invoice_id: factureId,
          environment: env,
          ...e,
        });
        if (error) this.logger.error(`Journal e-MCF non écrit (${profil.organization_id}) : ${error.message}`);
      },
    });
  }

  /**
   * Enregistre (ou remplace) le jeton e-MCF d'une entreprise après l'avoir essayé auprès de la DGI : un jeton refusé,
   * ou lié à un autre NIF, n'est pas gardé.
   */
  async enregistrerJeton(organizationId: string, jeton: string, environnement: EnvironnementEmcf, userId: string) {
    const propre = nettoyerJeton(jeton);
    if (propre.length < 20) throw new BadRequestException('Ce jeton e-MCF paraît incomplet : copiez-le en entier depuis le portail e-DEF');
    const profil = await this.profil(organizationId);
    if (!profil?.nif) throw new BadRequestException("Enregistrez d'abord le NIF de l'entreprise");
    const essai = { ...profil, emcf_environment: environnement, emcf_token_encrypted: this.jetons.chiffrer(propre) };
    let statut: StatutEmcf;
    try {
      statut = await this.clientEmcf(essai, null).statut();
    } catch (e) {
      throw new BadRequestException(e instanceof ErreurEmcf ? e.message : 'Vérification du jeton impossible');
    }
    if (statut.nif && statut.nif.toUpperCase() !== profil.nif.toUpperCase()) {
      throw new BadRequestException(`Ce jeton appartient au NIF ${statut.nif}, pas à celui de l'entreprise (${profil.nif})`);
    }
    const { error } = await this.db
      .from('fiscal_profiles')
      .update({
        emcf_environment: environnement,
        emcf_token_encrypted: essai.emcf_token_encrypted,
        emcf_token_hint: this.jetons.indice(propre),
        emcf_token_valid_until: statut.tokenValid ?? null,
        emcf_nim: statut.nim ?? null,
        emcf_status: statut.status ? 'operationnel' : 'indisponible',
        emcf_checked_at: new Date().toISOString(),
        updated_by: userId,
      })
      .eq('organization_id', organizationId);
    if (error) throw new BadRequestException(error.message);
    return { nim: statut.nim ?? null, valide_jusqu_au: statut.tokenValid ?? null, en_attente: statut.pendingRequestsCount ?? 0 };
  }

  /** Émet une facture normalisée : renvoie la facture confirmée, ou son état (bon provisoire, refus…) et pourquoi. */
  async emettre(d: DemandeEmission): Promise<VueFacture> {
    const profil = await this.profil(d.organizationId);
    if (!profil?.enabled || !profil.nif) {
      throw new BadRequestException("La facture normalisée n'est pas activée pour cette entreprise");
    }

    // Une même vente ne devient qu'une facture : on renvoie celle qui existe déjà.
    if (d.source.id && !estAvoir(d.facture.type)) {
      const deja = await this.parSource(d.source);
      if (deja) return deja.status === 'confirmed' ? deja : this.tenter(deja.id);
    }

    const facture: FactureAEmettre = {
      ...d.facture,
      mode: d.mode ?? profil.price_mode,
      groupesAutorises: profil.allowed_tax_groups?.length ? profil.allowed_tax_groups : GROUPES_HOMOLOGUES,
    };

    let origine: any = null;
    if (estAvoir(facture.type) && facture.avoir?.nature !== 'RRR') {
      origine = await this.verifierOrigine(d.organizationId, d.factureOrigineId, facture.articles);
      facture.avoir = { ...facture.avoir!, referenceCode: origine.code_def_dgi };
    }

    const v = validerFacture(facture);
    if (!v.ok) throw new BadRequestException({ message: 'Facture non conforme', erreurs: v.erreurs });

    const annee = anneeDeGestion();
    const { data: seq, error: eSeq } = await this.db.rpc('next_normalized_invoice_number', {
      p_organization_id: d.organizationId,
      p_fiscal_year: annee,
    });
    if (eSeq || !seq) throw new BadRequestException(`Numérotation impossible : ${eSeq?.message ?? 'sans réponse'}`);
    const rn = numeroFacture(annee, Number(seq));
    const devise = d.devise ? { ...d.devise, date: d.devise.date ?? new Date() } : undefined;
    const requete = construireRequete(facture, { nif: profil.nif, rn, isf: this.isf(profil.emcf_environment), operateur: d.operateur, devise });

    const { data: ligne, error } = await this.db
      .from('normalized_invoices')
      .insert({
        organization_id: d.organizationId,
        merchant_id: d.merchantId ?? null,
        source_type: d.source.type,
        source_id: d.source.id ?? null,
        invoice_type: facture.type,
        fiscal_year: annee,
        seq: Number(seq),
        rn,
        price_mode: facture.mode,
        status: 'pending',
        client: facture.client,
        operator_id: d.operateur.id ?? null,
        operator_name: d.operateur.nom,
        payments: facture.paiements ?? [],
        comments: requete.cmta || requete.cmtb ? Object.fromEntries(Object.entries(requete).filter(([k]) => /^cmt[a-h]$/.test(k))) : {},
        currency_code: devise?.code ?? null,
        currency_rate: devise?.taux ?? null,
        currency_date: devise?.date.toISOString() ?? null,
        original_invoice_id: origine?.id ?? null,
        reference_code: (requete.reference as string) ?? null,
        reference_type: facture.avoir?.nature ?? null,
        reference_desc: (requete.referenceDesc as string) ?? null,
        computed_totals: v.totaux,
        total_cents: v.totaux.totalCents,
        vat_cents: v.totaux.tvaCents,
        emcf_environment: profil.emcf_environment,
        request_snapshot: requete,
        created_by: d.userId ?? null,
      })
      .select('id')
      .single();
    if (error || !ligne) {
      // Deux caisses ont envoyé la même vente au même instant : l'autre l'a déjà créée.
      if (d.source.id && /uq_normalized_invoices_source|duplicate/i.test(error?.message ?? '')) {
        const deja = await this.parSource(d.source);
        if (deja) return deja;
      }
      throw new BadRequestException(`Facture non enregistrée : ${error?.message ?? 'sans réponse'}`);
    }

    const { error: eLignes } = await this.db.from('normalized_invoice_items').insert(
      facture.articles.map((a, i) => ligneArticle(ligne.id, i + 1, a, v.totaux.montantsLignes[i])),
    );
    if (eLignes) throw new BadRequestException(`Articles non enregistrés : ${eLignes.message}`);

    return this.tenter(ligne.id);
  }

  /**
   * Un essai de normalisation d'une facture (première émission ou reprise). Ce qui est envoyé est TOUJOURS
   * l'instantané enregistré à l'émission : un nouvel essai envoie exactement la même facture.
   */
  async tenter(factureId: string): Promise<VueFacture> {
    const { data: f, error } = await this.db.from('normalized_invoices').select('*').eq('id', factureId).single();
    if (error || !f) throw new NotFoundException('Facture introuvable');
    if (f.status === 'confirmed' || f.status === 'abandoned') return vue(f);
    // Confirmation envoyée sans réponse sûre : la DGI l'a peut-être normalisée. Renvoyer créerait un doublon ;
    // on attend la vérification (site de vérification de la DGI) — jamais de nouvel envoi automatique.
    if (f.last_error_code === 'A_VERIFIER') return vue(f);
    const profil = await this.profil(f.organization_id);
    if (!profil?.enabled) throw new BadRequestException("La facture normalisée n'est pas activée pour cette entreprise");

    // Le serveur s'est peut-être arrêté entre la confirmation de la DGI et l'enregistrement : la réponse est alors
    // dans le journal. On la reprend au lieu de renvoyer la facture.
    const dejaConfirmee = await this.confirmationDuJournal(f.id);
    if (dejaConfirmee) {
      const { data: apres } = await this.db.from('normalized_invoices').update(dejaConfirmee).eq('id', f.id).select(COLONNES_VUE).single();
      if (apres) return apres as VueFacture;
    }

    let issue: IssueNormalisation;
    try {
      issue = await normaliser(this.clientEmcf(profil, f.id), f.request_snapshot, f.computed_totals as TotauxFacture, {
        uidEnAttente: f.emcf_uid,
      });
    } catch (e) {
      issue = { statut: 'refusee', erreur: e instanceof ErreurEmcf ? e : new ErreurEmcf('reponse', (e as Error).message) };
    }
    const maj = miseAJour(issue, f.attempts);
    const { data: apres, error: eMaj } = await this.db
      .from('normalized_invoices')
      .update(maj)
      .eq('id', f.id)
      .select(COLONNES_VUE)
      .single();
    if (eMaj || !apres) {
      // La DGI a peut-être normalisé : ne rien perdre de ce qu'elle a renvoyé.
      this.logger.error(`Facture ${f.rn} : mise à jour impossible après l'e-MCF (${eMaj?.message}) — issue ${JSON.stringify(maj)}`);
      throw new BadRequestException('Facture normalisée par la DGI mais non enregistrée : contactez le support');
    }
    return apres as VueFacture;
  }

  /**
   * Reprise automatique : les bons provisoires (vendus sans réseau) et les demandes restées sans nouvelles.
   * S'arrête au premier « injoignable » : inutile d'insister tant que la DGI ne répond pas.
   */
  async reprendre(limite = 20): Promise<{ essayees: number; confirmees: number }> {
    const bloquee = new Date(Date.now() - ATTENTE_BLOQUEE_MS).toISOString();
    const { data, error } = await this.db
      .from('normalized_invoices')
      .select('id, status, updated_at')
      .or(`status.eq.provisional,and(status.eq.pending,updated_at.lt."${bloquee}")`)
      .order('created_at', { ascending: true })
      .limit(limite);
    if (error) throw new Error(error.message);
    let essayees = 0;
    let confirmees = 0;
    for (const f of data ?? []) {
      // Prendre la facture avant de l'envoyer : une autre instance ne l'enverra pas en même temps.
      const { data: prise } = await this.db
        .from('normalized_invoices')
        .update({ status: 'pending' })
        .eq('id', f.id)
        .eq('status', f.status)
        .eq('updated_at', f.updated_at)
        .select('id')
        .maybeSingle();
      if (!prise) continue;
      essayees += 1;
      const r = await this.tenter(f.id).catch((e) => {
        this.logger.warn(`Reprise de la facture ${f.id} : ${(e as Error).message}`);
        return null;
      });
      if (r?.status === 'confirmed') confirmees += 1;
      if (r?.status === 'provisional') break;
    }
    return { essayees, confirmees };
  }

  /** La dernière confirmation réussie de cette facture dans le journal e-MCF, prête à être enregistrée. */
  private async confirmationDuJournal(factureId: string): Promise<Record<string, unknown> | null> {
    const { data } = await this.db
      .from('emcf_exchanges')
      .select('path, response_body, created_at')
      .eq('invoice_id', factureId)
      .eq('operation', 'confirm')
      .eq('http_status', 200)
      .order('created_at', { ascending: false })
      .limit(1);
    const r = data?.[0]?.response_body as any;
    if (!r?.codeDEFDGI || !r?.qrCode) return null;
    const uid = String(data![0].path).split('/').slice(-2, -1)[0] || null;
    return {
      status: 'confirmed',
      emcf_uid: uid,
      code_def_dgi: r.codeDEFDGI,
      qr_code: r.qrCode,
      counters: r.counters ?? null,
      nim: r.nim ?? null,
      emcf_datetime: r.dateTime ?? null,
      last_error_code: null,
      last_error_desc: null,
      confirmed_at: new Date().toISOString(),
    };
  }

  async parSource(source: SourceFacture): Promise<VueFacture | null> {
    if (!source.id) return null;
    const { data } = await this.db
      .from('normalized_invoices')
      .select(COLONNES_VUE)
      .eq('source_type', source.type)
      .eq('source_id', source.id)
      .in('invoice_type', ['FV', 'FT', 'EV', 'ET'])
      .neq('status', 'abandoned')
      .maybeSingle();
    return (data as VueFacture) ?? null;
  }

  /** Avoir : la facture d'origine est normalisée, de la même entreprise, et les quantités restent remboursables. */
  private async verifierOrigine(organizationId: string, origineId: string | undefined, articles: ArticleFacture[]) {
    if (!origineId) throw new BadRequestException("Indiquez la facture de vente d'origine de l'avoir");
    const { data: origine } = await this.db
      .from('normalized_invoices')
      .select('id, organization_id, status, code_def_dgi, invoice_type')
      .eq('id', origineId)
      .maybeSingle();
    if (!origine || origine.organization_id !== organizationId) throw new NotFoundException("Facture d'origine introuvable");
    if (origine.status !== 'confirmed' || !origine.code_def_dgi) {
      throw new BadRequestException("La facture d'origine n'est pas normalisée : impossible d'en faire un avoir");
    }
    if (estAvoir(origine.invoice_type)) throw new BadRequestException("Un avoir se fait sur une facture de vente, pas sur un autre avoir");
    const { data: lignes } = await this.db
      .from('normalized_invoice_items')
      .select('id, unit_price_cents, quantity, tax_group')
      .eq('invoice_id', origine.id);
    const { data: avoirs } = await this.db
      .from('normalized_invoices')
      .select('id')
      .eq('original_invoice_id', origine.id)
      .in('status', ['confirmed', 'pending', 'provisional']);
    const deja: Record<string, number> = {};
    if (avoirs?.length) {
      const { data: rembourse } = await this.db
        .from('normalized_invoice_items')
        .select('original_item_id, quantity')
        .in('invoice_id', avoirs.map((a: any) => a.id));
      for (const r of rembourse ?? []) {
        if (r.original_item_id) deja[r.original_item_id] = (deja[r.original_item_id] ?? 0) + Number(r.quantity);
      }
    }
    const erreurs = verifierAvoir(
      (lignes ?? []).map((l: any) => ({ id: l.id, prixUnitaireCents: Number(l.unit_price_cents), quantite: String(l.quantity), groupe: l.tax_group })),
      Object.fromEntries(Object.entries(deja).map(([k, q]) => [k, q.toFixed(3)])),
      articles,
    );
    if (erreurs.length) throw new BadRequestException({ message: 'Avoir non conforme', erreurs });
    return origine;
  }
}

function ligneArticle(invoiceId: string, n: number, a: ArticleFacture, montant: number) {
  return {
    invoice_id: invoiceId,
    line_no: n,
    original_item_id: a.ligneOrigineId ?? null,
    code: a.code ?? null,
    item_type: a.type,
    name: a.nom,
    unit_of_measure: a.uniteMesure ?? null,
    unit_price_cents: a.prixUnitaireCents,
    quantity: String(a.quantite).replace(',', '.'),
    tax_group: a.groupe,
    specific_tax_cents: a.taxeSpecifiqueCents ?? null,
    original_price_cents: a.prixOrigineCents ?? null,
    price_modification: a.modificationPrix ?? null,
    line_total_cents: montant,
  };
}

/** Ce que devient la ligne de la facture selon l'issue de l'e-MCF. */
export function miseAJour(issue: IssueNormalisation, essais: number): Record<string, unknown> {
  const commun = { attempts: (essais ?? 0) + 1, emcf_requested_at: new Date().toISOString() };
  switch (issue.statut) {
    case 'confirmee':
      return {
        ...commun,
        status: 'confirmed',
        emcf_uid: issue.uid,
        emcf_totals: issue.montantsDgi,
        code_def_dgi: issue.elements.codeDEFDGI,
        qr_code: issue.elements.qrCode,
        counters: issue.elements.counters,
        nim: issue.elements.nim,
        emcf_datetime: issue.elements.dateTime,
        last_error_code: null,
        last_error_desc: null,
        confirmed_at: new Date().toISOString(),
      };
    case 'injoignable':
      return { ...commun, status: 'provisional', emcf_uid: null, last_error_code: issue.erreur.genre.toUpperCase(), last_error_desc: issue.erreur.message };
    case 'ecart':
      return {
        ...commun,
        status: 'failed',
        emcf_uid: null,
        emcf_totals: issue.montantsDgi,
        last_error_code: 'ECART',
        last_error_desc: `Montants différents de ceux de la DGI : ${issue.ecarts.map((e) => `${e.champ} ${e.nous / 100} ≠ ${e.dgi / 100}`).join(', ')}`,
      };
    case 'a_verifier':
      // « failed » : la reprise automatique n'y touche pas ; tenter() ne la renvoie jamais (code A_VERIFIER).
      return {
        ...commun,
        status: 'failed',
        emcf_uid: issue.uid,
        emcf_totals: issue.montantsDgi,
        last_error_code: 'A_VERIFIER',
        last_error_desc: `${issue.erreur.message} — à vérifier sur le site de vérification de la DGI avant toute autre action`,
      };
    case 'refusee':
      return {
        ...commun,
        status: 'failed',
        emcf_uid: issue.uid ?? null,
        last_error_code: issue.erreur.code ?? issue.erreur.genre.toUpperCase(),
        last_error_desc: issue.erreur.message,
      };
  }
}

const vue = (f: any): VueFacture => ({
  id: f.id,
  rn: f.rn,
  invoice_type: f.invoice_type,
  status: f.status,
  total_cents: f.total_cents,
  vat_cents: f.vat_cents,
  code_def_dgi: f.code_def_dgi,
  qr_code: f.qr_code,
  counters: f.counters,
  nim: f.nim,
  emcf_datetime: f.emcf_datetime,
  last_error_code: f.last_error_code,
  last_error_desc: f.last_error_desc,
});
