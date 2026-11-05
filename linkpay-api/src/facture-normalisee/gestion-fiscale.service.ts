import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { StockService, POS_SALE_ROLES } from '../stock/stock.service';
import { WalletPinService } from '../wallets/wallet-pin.service';
import { calculerTotaux, cdfVersUsd } from './calcul';
import { EnvironnementEmcf, ErreurEmcf } from './emcf.client';
import { FactureNormaliseeService, ProfilFiscal, VueFacture } from './facture-normalisee.service';
import {
  estAvoir,
  GroupeTaxation,
  GROUPES_HOMOLOGUES,
  LIBELLES_GROUPES,
  LIBELLES_NATURES_AVOIR,
  LIBELLES_TYPES_CLIENT,
  LIBELLES_TYPES_FACTURE,
  NatureAvoir,
  TAUX_2026,
  TypeFacture,
} from './groupes';
import { montantEnLettres } from './montant-en-lettres';
import { depuisTicket, depuisVente } from './sources';
import { ArticleFacture, ClientFacture, NIF_VALIDE, PaiementFacture } from './validation';

export interface Appelant {
  id: string;
  role?: string;
  organization_id?: string;
}

const ADMINS = ['admin', 'super_admin'];
/** Taux du dollar de l'e-MCF gardé 10 minutes (la DGI le publie une fois par jour). */
const DUREE_TAUX_MS = 10 * 60 * 1000;

/**
 * Tout ce que les écrans demandent : profil fiscal (patron et gérants), jeton, activation, factures (liste, impression,
 * duplicata), émission depuis une vente, avoirs (patron et gérants, avec leur code PIN), factures saisies à la main
 * (cas de test de la DGI, services). Les droits sont vérifiés ici, en lisant la base à chaque requête.
 */
@Injectable()
export class GestionFiscaleService {
  private tauxCache = new Map<EnvironnementEmcf, { taux: string; date: string; lu: number }>();

  constructor(
    private supabase: SupabaseService,
    private factures: FactureNormaliseeService,
    private stock: StockService,
    private pins: WalletPinService,
  ) {}

  private get db() {
    return this.supabase.getClient();
  }

  // ------------------------------------------------------------------ droits

  /** « gestion » : patron (propriétaire) ou gérant de l'entreprise ; « lecture » : comptable. */
  async droits(organizationId: string, u: Appelant): Promise<'gestion' | 'lecture'> {
    if (ADMINS.includes(u.role ?? '')) return 'gestion';
    const { data: org } = await this.db.from('organizations').select('id, owner_id').eq('id', organizationId).maybeSingle();
    if (!org) throw new NotFoundException('Entreprise introuvable');
    if (org.owner_id === u.id) return 'gestion';
    if (u.organization_id === organizationId) {
      const { data: staff } = await this.db
        .from('organization_staff')
        .select('deactivated_at')
        .eq('organization_id', organizationId)
        .eq('user_id', u.id)
        .maybeSingle();
      if (staff && !staff.deactivated_at) {
        if (u.role === 'gerant') return 'gestion';
        if (u.role === 'comptable') return 'lecture';
      }
    }
    throw new ForbiddenException('Réservé au patron et aux gérants de l’entreprise');
  }

  private async exigerGestion(organizationId: string, u: Appelant) {
    if ((await this.droits(organizationId, u)) !== 'gestion') {
      throw new ForbiddenException('Réservé au patron et aux gérants de l’entreprise');
    }
  }

  // ------------------------------------------------------------------ groupe de taxation par catégorie

  /**
   * Les catégories de produits de l'entreprise et le groupe réglé pour chacune : celles que ses produits utilisent
   * (avec leur nombre de produits) et celles qui ont déjà un groupe. Les catégories du secteur, pas encore utilisées, sont
   * ajoutées par l'écran.
   */
  async categories(organizationId: string, u: Appelant) {
    await this.droits(organizationId, u);
    const [{ data: utilisees }, { data: reglees }, p] = await Promise.all([
      this.db.rpc('fiscal_organization_categories', { p_org: organizationId }),
      this.db.from('fiscal_category_groups').select('category, tax_group').eq('organization_id', organizationId),
      this.factures.profil(organizationId),
    ]);
    const groupe = new Map<string, string>((reglees ?? []).map((r: any) => [r.category as string, r.tax_group as string]));
    const lignes = new Map<string, { category: string; produits: number; groupe: string | null }>();
    for (const c of (utilisees ?? []) as any[]) lignes.set(c.category, { category: c.category, produits: Number(c.products), groupe: groupe.get(c.category) ?? null });
    for (const [category, g] of groupe) if (!lignes.has(category)) lignes.set(category, { category, produits: 0, groupe: g });
    return {
      categories: [...lignes.values()].sort((a, b) => a.category.localeCompare(b.category, 'fr')),
      groupes_autorises: p?.allowed_tax_groups?.length ? p.allowed_tax_groups : GROUPES_HOMOLOGUES,
      groupe_par_defaut: p ? (p.default_tax_group ?? (p.vat_regime === 'assujetti' ? 'B' : 'K')) : null,
    };
  }

  /** Règle le groupe d'une catégorie (null = on l'enlève : ses produits reprennent le groupe par défaut de l'entreprise). */
  async majGroupeCategorie(organizationId: string, u: Appelant, categorie: string, groupe: string | null) {
    await this.exigerGestion(organizationId, u);
    const category = (categorie ?? '').trim();
    if (!category || category.length > 100) throw new BadRequestException('Catégorie invalide');
    if (groupe === null) {
      const { error } = await this.db.from('fiscal_category_groups').delete().eq('organization_id', organizationId).eq('category', category);
      if (error) throw new BadRequestException(error.message);
    } else {
      const p = await this.factures.profil(organizationId);
      const autorises = p?.allowed_tax_groups?.length ? p.allowed_tax_groups : GROUPES_HOMOLOGUES;
      if (!(autorises as readonly string[]).includes(groupe)) throw new BadRequestException(`Le groupe ${groupe} n'est pas autorisé pour cette entreprise`);
      const { error } = await this.db
        .from('fiscal_category_groups')
        .upsert({ organization_id: organizationId, category, tax_group: groupe, updated_by: u.id, updated_at: new Date().toISOString() }, { onConflict: 'organization_id,category' });
      if (error) throw new BadRequestException(error.message);
    }
    return this.categories(organizationId, u);
  }

  // ------------------------------------------------------------------ profil fiscal

  /** Le profil tel que les écrans le voient : jamais le jeton, seulement son indice. */
  async voirProfil(organizationId: string, u: Appelant) {
    const droits = await this.droits(organizationId, u);
    const p = await this.factures.profil(organizationId);
    return {
      droits,
      profil: p
        ? {
            enabled: p.enabled,
            nif: p.nif,
            vat_regime: p.vat_regime,
            price_mode: p.price_mode,
            default_tax_group: p.default_tax_group,
            allowed_tax_groups: p.allowed_tax_groups,
            emcf_environment: p.emcf_environment,
            jeton_enregistre: !!p.emcf_token_encrypted,
            jeton_indice: p.emcf_token_hint,
            emcf_nim: p.emcf_nim,
            ...(await this.complementProfil(organizationId)),
          }
        : null,
      groupes: (Object.keys(TAUX_2026) as GroupeTaxation[]).map((g) => ({
        groupe: g,
        taux: TAUX_2026[g],
        libelle: LIBELLES_GROUPES[g],
        autorise: (p?.allowed_tax_groups ?? GROUPES_HOMOLOGUES).includes(g),
      })),
    };
  }

  private async complementProfil(organizationId: string) {
    const { data } = await this.db
      .from('fiscal_profiles')
      .select('trade_name, address, phone, email, emcf_token_valid_until, emcf_status, emcf_checked_at, activated_at')
      .eq('organization_id', organizationId)
      .maybeSingle();
    return data ?? {};
  }

  async majProfil(
    organizationId: string,
    u: Appelant,
    d: {
      nif?: string;
      vat_regime?: 'assujetti' | 'non_assujetti';
      price_mode?: 'ttc' | 'ht';
      default_tax_group?: string | null;
      trade_name?: string;
      address?: string;
      phone?: string;
      email?: string;
    },
  ) {
    await this.exigerGestion(organizationId, u);
    const nif = d.nif !== undefined ? d.nif.trim().toUpperCase() : undefined;
    if (nif !== undefined && !NIF_VALIDE.test(nif)) throw new BadRequestException('Le NIF doit avoir 9 caractères (lettres et chiffres), ex. A2216742Y');
    const actuel = await this.factures.profil(organizationId);
    if (d.default_tax_group && !(actuel?.allowed_tax_groups ?? GROUPES_HOMOLOGUES).includes(d.default_tax_group as GroupeTaxation)) {
      throw new BadRequestException(`Le groupe ${d.default_tax_group} n'est pas autorisé`);
    }
    // Changer de NIF invalide le jeton (il est lié à un NIF) : il faudra le réenregistrer.
    const nifChange = actuel?.nif && nif && nif !== actuel.nif;
    const champs: Record<string, unknown> = {
      ...(nif !== undefined ? { nif } : {}),
      ...(d.vat_regime ? { vat_regime: d.vat_regime } : {}),
      ...(d.price_mode ? { price_mode: d.price_mode } : {}),
      ...(d.default_tax_group !== undefined ? { default_tax_group: d.default_tax_group || null } : {}),
      ...(d.trade_name !== undefined ? { trade_name: d.trade_name.trim() || null } : {}),
      ...(d.address !== undefined ? { address: d.address.trim() || null } : {}),
      ...(d.phone !== undefined ? { phone: d.phone.trim() || null } : {}),
      ...(d.email !== undefined ? { email: d.email.trim() || null } : {}),
      ...(nifChange ? { enabled: false, emcf_token_encrypted: null, emcf_token_hint: null, emcf_nim: null } : {}),
      updated_by: u.id,
    };
    const { error } = actuel
      ? await this.db.from('fiscal_profiles').update(champs).eq('organization_id', organizationId)
      : await this.db.from('fiscal_profiles').insert({ organization_id: organizationId, ...champs });
    if (error) throw new BadRequestException(error.message);
    return this.voirProfil(organizationId, u);
  }

  async enregistrerJeton(organizationId: string, u: Appelant, jeton: string, environnement: EnvironnementEmcf) {
    await this.exigerGestion(organizationId, u);
    return this.factures.enregistrerJeton(organizationId, jeton, environnement, u.id);
  }

  /** État en direct de l'e-MCF de l'entreprise (jeton valide, NIM, demandes en attente). */
  async etat(organizationId: string, u: Appelant) {
    await this.droits(organizationId, u);
    const p = await this.factures.profil(organizationId);
    if (!p?.emcf_token_encrypted) return { connecte: false, message: "Aucun jeton e-MCF n'est enregistré" };
    try {
      const s = await this.factures.clientEmcf(p, null).statut();
      return { connecte: !!s.status, nim: s.nim ?? null, valide_jusqu_au: s.tokenValid ?? null, en_attente: s.pendingRequestsCount ?? 0, heure_dgi: s.serverDateTime ?? null };
    } catch (e) {
      return { connecte: false, message: e instanceof ErreurEmcf ? e.message : 'Vérification impossible' };
    }
  }

  async activer(organizationId: string, u: Appelant, actif: boolean) {
    await this.exigerGestion(organizationId, u);
    const p = await this.factures.profil(organizationId);
    if (actif) {
      if (!p?.nif) throw new BadRequestException("Enregistrez d'abord le NIF de l'entreprise");
      if (!p.emcf_token_encrypted) throw new BadRequestException("Enregistrez d'abord le jeton e-MCF (portail e-DEF de la DGI)");
      if (p.emcf_environment === 'production') this.factures.isf('production'); // refuse tant que ScanLinkPay n'est pas homologué
    }
    const { error } = await this.db
      .from('fiscal_profiles')
      .update({ enabled: actif, ...(actif ? { activated_at: new Date().toISOString(), activated_by: u.id } : {}), updated_by: u.id })
      .eq('organization_id', organizationId);
    if (error) throw new BadRequestException(error.message);
    return this.voirProfil(organizationId, u);
  }

  // ------------------------------------------------------------------ taux du dollar

  /** Taux USD de l'e-MCF (`/api/info/currencyRates`) : la référence à 1 % près du taux de la Banque Centrale. */
  async tauxUsd(p: ProfilFiscal): Promise<string | null> {
    const c = this.tauxCache.get(p.emcf_environment);
    if (c && Date.now() - c.lu < DUREE_TAUX_MS) return c.taux;
    try {
      const liste = await this.factures.clientEmcf(p, null).information<any[]>('currencyRates');
      const usd = (Array.isArray(liste) ? liste : []).find((r) => String(r?.type ?? '').toUpperCase() === 'USD');
      const taux = usd?.rate !== undefined ? Number(usd.rate) : NaN;
      if (!Number.isFinite(taux) || taux <= 0) return c?.taux ?? null;
      const t = taux.toFixed(4).replace(/\.?0+$/, '');
      this.tauxCache.set(p.emcf_environment, { taux: t, date: usd.date ?? '', lu: Date.now() });
      return t;
    } catch {
      return c?.taux ?? null;
    }
  }

  // ------------------------------------------------------------------ émission depuis une vente

  /** Facture normalisée d'un ticket de caisse ou d'une vente payés (tout vendeur de la station). */
  async emettreDepuisVente(merchantId: string, u: Appelant, source: { type: 'pos_ticket' | 'sale'; id: string }, client: ClientFacture) {
    const merchant = await this.stock.resolveMerchantAccess(merchantId, u.id, u.role, u.organization_id, POS_SALE_ROLES);
    return this.emettreInterne(merchant, source, client, u.id);
  }

  /** Émission sans contrôle d'accès : appelée après le contrôle, ou par le ramassage automatique. */
  private async emettreInterne(
    merchant: { id: string; organization_id: string | null },
    source: { type: 'pos_ticket' | 'sale'; id: string },
    client: ClientFacture,
    userId: string | null,
  ) {
    if (!merchant.organization_id) throw new BadRequestException("Ce magasin n'appartient à aucune entreprise");
    const profil = await this.factures.profil(merchant.organization_id);
    if (!profil?.enabled) throw new BadRequestException("La facture normalisée n'est pas activée pour cette entreprise");
    const deja = await this.factures.parSource(source);
    if (deja?.status === 'confirmed') return deja;
    const taux = () => this.tauxUsd(profil);
    const m = { id: merchant.id, organization_id: merchant.organization_id };
    const demande =
      source.type === 'pos_ticket'
        ? await depuisTicket(this.db, m, source.id, client, profil, taux, userId ?? '')
        : await depuisVente(this.db, m, source.id, client, profil, taux, userId ?? '');
    return this.factures.emettre({ ...demande, userId });
  }

  /**
   * Filet de sécurité (chaque minute) : dans une entreprise soumise, TOUTE vente payée devient une facture normalisée,
   * même si le caissier n'a pas appuyé sur le bouton, ou si la vente a été faite sans réseau puis synchronisée.
   * Le caissier a 2 minutes pour choisir le type de client ; ensuite c'est « Personne physique ».
   */
  async ramasser(limite = 20): Promise<number> {
    const { data: profils } = await this.db.from('fiscal_profiles').select('organization_id, activated_at').eq('enabled', true);
    let emises = 0;
    const avant = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    for (const p of profils ?? []) {
      if (emises >= limite) break;
      const { data: magasins } = await this.db.from('merchants').select('id, organization_id').eq('organization_id', p.organization_id);
      const ids = (magasins ?? []).map((m: any) => m.id);
      if (!ids.length) continue;
      const depuis = p.activated_at ?? avant;
      const [{ data: tickets }, { data: ventes }] = await Promise.all([
        this.db.from('pos_tickets').select('id, merchant_id').in('merchant_id', ids).eq('status', 'paid').gte('paid_at', depuis).lt('paid_at', avant).limit(limite),
        this.db.from('sales').select('id, merchant_id').in('merchant_id', ids).eq('status', 'PAID').gte('paid_at', depuis).lt('paid_at', avant).limit(limite),
      ]);
      const candidats = [
        ...(tickets ?? []).map((t: any) => ({ type: 'pos_ticket' as const, id: t.id, merchant_id: t.merchant_id })),
        ...(ventes ?? []).map((v: any) => ({ type: 'sale' as const, id: v.id, merchant_id: v.merchant_id })),
      ];
      if (!candidats.length) continue;
      const { data: faites } = await this.db
        .from('normalized_invoices')
        .select('source_type, source_id')
        .in('source_id', candidats.map((c) => c.id));
      const deja = new Set((faites ?? []).map((f: any) => `${f.source_type}:${f.source_id}`));
      for (const c of candidats) {
        if (emises >= limite) break;
        if (deja.has(`${c.type}:${c.id}`)) continue;
        try {
          await this.emettreInterne({ id: c.merchant_id, organization_id: p.organization_id }, { type: c.type, id: c.id }, { type: 'PP' }, null);
          emises += 1;
        } catch {
          // Une vente qui ne passe pas (ex. ticket USD sans taux du dollar) est reprise au prochain tour.
        }
      }
    }
    return emises;
  }

  /** La facture normalisée d'une vente, si elle existe (pour afficher son état sur le reçu). */
  async factureDeLaVente(merchantId: string, u: Appelant, source: { type: 'pos_ticket' | 'sale'; id: string }) {
    const merchant = await this.stock.resolveMerchantAccess(merchantId, u.id, u.role, u.organization_id, POS_SALE_ROLES);
    const profil = merchant.organization_id ? await this.factures.profil(merchant.organization_id) : null;
    return {
      active: !!profil?.enabled,
      organization_id: merchant.organization_id ?? null,
      facture: profil?.enabled ? await this.factures.parSource(source) : null,
    };
  }

  // ------------------------------------------------------------------ factures

  async liste(organizationId: string, u: Appelant, f: { status?: string; limit?: number; offset?: number }) {
    await this.droits(organizationId, u);
    let q = this.db
      .from('normalized_invoices')
      .select('id, rn, invoice_type, status, total_cents, vat_cents, code_def_dgi, client, operator_name, created_at, confirmed_at, last_error_code, last_error_desc, original_invoice_id, reference_type', { count: 'exact' })
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .range(f.offset ?? 0, (f.offset ?? 0) + Math.min(f.limit ?? 50, 200) - 1);
    if (f.status) q = q.eq('status', f.status);
    const { data, error, count } = await q;
    if (error) throw new BadRequestException(error.message);
    return { factures: data ?? [], total: count ?? 0 };
  }

  /** Accès à une facture : la gestion de l'entreprise, ou le vendeur de la station qui l'a émise (pour imprimer). */
  private async chargerAvecDroit(organizationId: string, factureId: string, u: Appelant) {
    const { data: f } = await this.db.from('normalized_invoices').select('*').eq('id', factureId).eq('organization_id', organizationId).maybeSingle();
    if (!f) throw new NotFoundException('Facture introuvable');
    try {
      await this.droits(organizationId, u);
    } catch (e) {
      if (!f.merchant_id) throw e;
      await this.stock.resolveMerchantAccess(f.merchant_id, u.id, u.role, u.organization_id, POS_SALE_ROLES);
    }
    return f;
  }

  /** Tout ce qu'il faut pour imprimer la facture avec ses mentions obligatoires (1.2.1 a à x). */
  async detail(organizationId: string, factureId: string, u: Appelant) {
    const f = await this.chargerAvecDroit(organizationId, factureId, u);
    return this.vueImpression(f, f.print_count > 0);
  }

  /** Impression : la première est l'originale, toutes les suivantes portent DUPLICATA (même numéro). */
  async imprimer(organizationId: string, factureId: string, u: Appelant) {
    const f = await this.chargerAvecDroit(organizationId, factureId, u);
    if (f.status !== 'confirmed') throw new BadRequestException("Seule une facture normalisée s'imprime comme facture (sinon : bon provisoire)");
    const duplicata = f.print_count > 0;
    await this.db.from('normalized_invoices').update({ print_count: f.print_count + 1 }).eq('id', f.id);
    return this.vueImpression(f, duplicata);
  }

  async reessayer(organizationId: string, factureId: string, u: Appelant): Promise<VueFacture> {
    const f = await this.chargerAvecDroit(organizationId, factureId, u);
    return this.factures.tenter(f.id);
  }

  private async vueImpression(f: any, duplicata: boolean) {
    const [{ data: lignes }, { data: org }, profil] = await Promise.all([
      this.db.from('normalized_invoice_items').select('*').eq('invoice_id', f.id).order('line_no'),
      this.db.from('organizations').select('name, legal_name, contact').eq('id', f.organization_id).maybeSingle(),
      this.complementProfil(f.organization_id),
    ]);
    const p = await this.factures.profil(f.organization_id);
    const totaux = f.computed_totals ?? { groupes: [] };
    const contact = (org?.contact ?? {}) as Record<string, string>;
    const equivalent =
      f.currency_code && f.currency_rate && f.total_cents ? { devise: f.currency_code, taux: String(f.currency_rate), montant_cents: cdfVersUsd(f.total_cents, String(f.currency_rate)) } : null;
    let origine: { rn: string; code_def_dgi: string } | null = null;
    if (f.original_invoice_id) {
      const { data } = await this.db.from('normalized_invoices').select('rn, code_def_dgi').eq('id', f.original_invoice_id).maybeSingle();
      origine = data ?? null;
    }
    return {
      facture: {
        id: f.id,
        rn: f.rn,
        type: f.invoice_type,
        type_libelle: LIBELLES_TYPES_FACTURE[f.invoice_type as TypeFacture],
        mode: f.price_mode,
        status: f.status,
        duplicata,
        provisoire: f.status !== 'confirmed',
        date_heure: f.emcf_datetime ?? null,
        cree_le: f.created_at,
        code_def_dgi: f.code_def_dgi,
        qr_code: f.qr_code,
        compteurs: f.counters,
        nim: f.nim,
        isf: f.request_snapshot?.isf ?? null,
        operateur: f.operator_name,
        avoir: f.reference_type ? { nature: f.reference_type, libelle: LIBELLES_NATURES_AVOIR[f.reference_type as NatureAvoir], reference: f.reference_code, origine } : null,
        erreur: f.last_error_code ? { code: f.last_error_code, description: f.last_error_desc } : null,
      },
      vendeur: {
        denomination: (profil as any).trade_name || org?.legal_name || org?.name || '',
        nif: p?.nif ?? '',
        regime: p?.vat_regime === 'assujetti' ? 'Assujetti à la TVA' : 'Non assujetti à la TVA',
        adresse: (profil as any).address || contact.address || '',
        telephone: (profil as any).phone || contact.phone || '',
        email: (profil as any).email || contact.email || '',
      },
      client: { ...f.client, type_libelle: LIBELLES_TYPES_CLIENT[f.client?.type as keyof typeof LIBELLES_TYPES_CLIENT] ?? '' },
      articles: (lignes ?? []).map((l: any) => ({
        ligne_id: l.id,
        nom: l.name,
        code: l.code,
        type: l.item_type,
        groupe: l.tax_group,
        unite: l.unit_of_measure,
        quantite: Number(l.quantity),
        prix_unitaire_cents: Number(l.unit_price_cents),
        prix_origine_cents: l.original_price_cents ? Number(l.original_price_cents) : null,
        modification: l.price_modification,
        taxe_specifique_cents: l.specific_tax_cents ? Number(l.specific_tax_cents) : null,
        montant_cents: Number(l.line_total_cents),
      })),
      groupes: (totaux.groupes ?? []).map((g: any) => ({ ...g, libelle: LIBELLES_GROUPES[g.groupe as GroupeTaxation] })),
      total_cents: f.total_cents,
      tva_cents: f.vat_cents,
      taxe_specifique_cents: totaux.taxeSpecifiqueCents ?? 0,
      total_en_lettres: f.total_cents ? montantEnLettres(f.total_cents, 'CDF') : '',
      equivalent_devise: equivalent,
      paiements: f.payments ?? [],
      commentaires: Object.entries(f.comments ?? {}).map(([code, texte]) => ({ code: code.slice(-1).toUpperCase(), texte })),
    };
  }

  // ------------------------------------------------------------------ avoirs (patron et gérants, avec PIN)

  async avoir(
    organizationId: string,
    factureId: string,
    u: Appelant,
    d: { nature: NatureAvoir; pin: string; lignes?: { ligne_id: string; quantite: string }[]; motif?: string; moyen_remboursement?: PaiementFacture['moyen'] },
  ) {
    await this.exigerGestion(organizationId, u);
    await this.pins.verifyPin(u.id, d.pin);
    if (d.nature === 'RRR') throw new BadRequestException('Une remise (RRR) se saisit comme facture manuelle, sans facture d’origine');
    const { data: origine } = await this.db.from('normalized_invoices').select('*').eq('id', factureId).eq('organization_id', organizationId).maybeSingle();
    if (!origine) throw new NotFoundException('Facture introuvable');
    const { data: lignes } = await this.db.from('normalized_invoice_items').select('*').eq('invoice_id', origine.id).order('line_no');
    const choix = d.lignes?.length ? d.lignes : (lignes ?? []).map((l: any) => ({ ligne_id: l.id, quantite: String(l.quantity) }));
    const parId = new Map((lignes ?? []).map((l: any) => [l.id, l]));
    const articles: ArticleFacture[] = choix.map((c) => {
      const l: any = parId.get(c.ligne_id);
      if (!l) throw new BadRequestException("Un article choisi n'est pas sur la facture d'origine");
      return {
        nom: l.name,
        code: l.code ?? undefined,
        type: l.item_type,
        groupe: l.tax_group,
        prixUnitaireCents: Number(l.unit_price_cents),
        quantite: c.quantite,
        uniteMesure: l.unit_of_measure ?? undefined,
        ligneOrigineId: l.id,
      };
    });
    const type: TypeFacture = origine.invoice_type === 'EV' || origine.invoice_type === 'ET' ? 'EA' : 'FA';
    // Le remboursement est égal au total de l'avoir, calculé par le moteur (mêmes règles que la facture).
    const total = calculerTotaux(articles, origine.price_mode).totalCents;
    return this.factures.emettre({
      organizationId,
      merchantId: origine.merchant_id,
      source: { type: 'manual' },
      facture: {
        type,
        articles,
        client: origine.client,
        paiements: [{ moyen: d.moyen_remboursement ?? 'ESPECES', montantCents: total }],
        avoir: { nature: d.nature },
        commentaires: d.motif?.trim() ? [`Motif : ${d.motif.trim().slice(0, 100)}`] : undefined,
      },
      mode: origine.price_mode,
      factureOrigineId: origine.id,
      operateur: { id: u.id, nom: await this.nom(u.id) },
      userId: u.id,
    });
  }

  // ------------------------------------------------------------------ facture saisie à la main

  /**
   * Facture saisie à la main par le patron ou un gérant : un service, une remise générale (avoir RRR), et les cas de
   * test de l'homologation (tous les types, groupes, modes TTC et HT).
   */
  async manuelle(
    organizationId: string,
    u: Appelant,
    d: {
      type: TypeFacture;
      mode?: 'ttc' | 'ht';
      articles: ArticleFacture[];
      client: ClientFacture;
      paiements?: PaiementFacture[];
      commentaires?: string[];
      reference_derogation?: string;
      facture_origine_id?: string;
      nature_avoir?: NatureAvoir;
      pin?: string;
    },
  ) {
    await this.exigerGestion(organizationId, u);
    if (estAvoir(d.type)) {
      if (!d.pin) throw new BadRequestException('Un avoir demande votre code PIN');
      await this.pins.verifyPin(u.id, d.pin);
    }
    return this.factures.emettre({
      organizationId,
      source: { type: 'manual' },
      facture: {
        type: d.type,
        articles: d.articles,
        client: d.client,
        paiements: d.paiements ?? [],
        commentaires: d.commentaires,
        referenceDerogation: d.reference_derogation,
        avoir: estAvoir(d.type) ? { nature: d.nature_avoir! } : undefined,
      },
      mode: d.mode,
      factureOrigineId: d.facture_origine_id,
      operateur: { id: u.id, nom: await this.nom(u.id) },
      userId: u.id,
    });
  }

  private async nom(userId: string) {
    const { data } = await this.db.from('profiles').select('full_name').eq('id', userId).maybeSingle();
    return (data?.full_name as string)?.trim() || 'Gérant';
  }
}
