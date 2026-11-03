import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { FactureNormaliseeService } from './facture-normalisee.service';
import { Appelant, GestionFiscaleService } from './gestion-fiscale.service';
import { contenuRapportA, contenuRapportXZ, FacturePourRapport, LignePourRapportA, MouvementEspeces } from './rapports';

export type TypeRapport = 'X' | 'XP' | 'Z' | 'A';

export const LIBELLES_RAPPORTS: Record<TypeRapport, string> = {
  X: 'Rapport X (journalier)',
  XP: 'Rapport X périodique',
  Z: 'Rapport Z (clôture)',
  A: 'Rapport A (articles)',
};

/** Supabase rend au plus 1 000 lignes par requête : on lit par pages. */
const PAGE = 1000;
/** Une liste d'identifiants passée en « in (…) » reste courte (taille de l'URL). */
const LOT = 150;
/** Un rapport X périodique couvre au plus un an (au-delà, on fait plusieurs rapports). */
const PERIODE_MAX_MS = 366 * 24 * 3600 * 1000;

/**
 * Rapports X, Z et A (note de service 01/022, 1.3 et 1.4). Chaque rapport est calculé à partir des factures
 * NORMALISÉES de l'entreprise, puis gardé figé dans fiscal_reports (journal électronique) : on le relit et on le
 * réimprime à l'identique, on ne le recalcule jamais.
 *   X  : depuis le dernier Z jusqu'à maintenant (ne ferme rien) — patron, gérants, comptable.
 *   XP : X d'une période choisie — patron, gérants, comptable.
 *   Z  : depuis le dernier Z, et FERME la période (numéroté) — patron et gérants.
 *   A  : articles depuis le dernier rapport A — patron et gérants.
 */
@Injectable()
export class RapportsFiscauxService {
  constructor(
    private supabase: SupabaseService,
    private gestion: GestionFiscaleService,
    private factures: FactureNormaliseeService,
  ) {}

  private get db() {
    return this.supabase.getClient();
  }

  // ------------------------------------------------------------------ lecture

  async liste(organizationId: string, u: Appelant, f: { type?: string; limit?: number; offset?: number }) {
    await this.gestion.droits(organizationId, u);
    const debut = f.offset ?? 0;
    let q = this.db
      .from('fiscal_reports')
      .select('id, report_type, seq, period_start, period_end, print_count, created_at, totaux:data->totaux', { count: 'exact' })
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .range(debut, debut + Math.min(f.limit ?? 50, 200) - 1);
    if (f.type) q = q.eq('report_type', f.type);
    const { data, error, count } = await q;
    if (error) throw new BadRequestException(error.message);
    const derniers = await this.derniers(organizationId);
    return {
      rapports: data ?? [],
      total: count ?? 0,
      prochain_z: (derniers.Z?.seq ?? 0) + 1,
      dernier_z: derniers.Z ? { seq: derniers.Z.seq, period_end: derniers.Z.period_end } : null,
      dernier_a: derniers.A ? { seq: derniers.A.seq, period_end: derniers.A.period_end } : null,
    };
  }

  async detail(organizationId: string, id: string, u: Appelant) {
    await this.gestion.droits(organizationId, u);
    const r = await this.charger(organizationId, id);
    return this.vue(r, r.print_count > 0);
  }

  /** Réimpression : le rapport ne change pas ; à partir de la deuxième, il porte « DUPLICATA ». */
  async imprimer(organizationId: string, id: string, u: Appelant) {
    await this.gestion.droits(organizationId, u);
    const r = await this.charger(organizationId, id);
    await this.db.from('fiscal_reports').update({ print_count: r.print_count + 1 }).eq('id', r.id);
    return this.vue(r, r.print_count > 0);
  }

  private async charger(organizationId: string, id: string) {
    const { data } = await this.db.from('fiscal_reports').select('*').eq('id', id).eq('organization_id', organizationId).maybeSingle();
    if (!data) throw new NotFoundException('Rapport introuvable');
    return data;
  }

  private vue(r: any, duplicata: boolean) {
    return {
      id: r.id,
      type: r.report_type as TypeRapport,
      libelle: LIBELLES_RAPPORTS[r.report_type as TypeRapport],
      seq: r.seq,
      debut: r.period_start,
      fin: r.period_end,
      cree_le: r.created_at,
      duplicata,
      ...r.data,
    };
  }

  // ------------------------------------------------------------------ création

  /** X (depuis le dernier Z) ou XP (période choisie). Ne ferme rien, mais reste dans le journal. */
  async rapportX(organizationId: string, u: Appelant, periode?: { debut: string; fin: string }) {
    await this.gestion.droits(organizationId, u);
    const maintenant = new Date();
    let debut: Date;
    let fin = maintenant;
    if (periode) {
      debut = new Date(periode.debut);
      fin = new Date(periode.fin);
      if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime())) throw new BadRequestException('Dates invalides');
      if (fin > maintenant) fin = maintenant;
      if (fin <= debut) throw new BadRequestException('La fin de la période doit suivre son début');
      if (fin.getTime() - debut.getTime() > PERIODE_MAX_MS) throw new BadRequestException('Une période couvre au plus un an');
    } else {
      debut = await this.debutDepuisDernier(organizationId, 'Z');
    }
    return this.enregistrer(organizationId, u, periode ? 'XP' : 'X', 0, debut, fin);
  }

  /** Z : clôture de tout ce qui a été normalisé depuis le dernier Z. */
  async rapportZ(organizationId: string, u: Appelant) {
    await this.exigerGestion(organizationId, u);
    const dernier = (await this.derniers(organizationId)).Z;
    const debut = await this.debutDepuisDernier(organizationId, 'Z');
    return this.enregistrer(organizationId, u, 'Z', (dernier?.seq ?? 0) + 1, debut, new Date());
  }

  /** A : articles vendus et retournés depuis le dernier rapport A, avec le stock du moment. */
  async rapportA(organizationId: string, u: Appelant) {
    await this.exigerGestion(organizationId, u);
    const dernier = (await this.derniers(organizationId)).A;
    const debut = await this.debutDepuisDernier(organizationId, 'A');
    return this.enregistrer(organizationId, u, 'A', (dernier?.seq ?? 0) + 1, debut, new Date());
  }

  private async exigerGestion(organizationId: string, u: Appelant) {
    if ((await this.gestion.droits(organizationId, u)) !== 'gestion') {
      throw new ForbiddenException('La clôture (Z) et le rapport A sont réservés au patron et aux gérants');
    }
  }

  private async derniers(organizationId: string) {
    const lire = async (type: 'Z' | 'A') =>
      (
        await this.db
          .from('fiscal_reports')
          .select('seq, period_end')
          .eq('organization_id', organizationId)
          .eq('report_type', type)
          .order('seq', { ascending: false })
          .limit(1)
          .maybeSingle()
      ).data as { seq: number; period_end: string } | null;
    const [Z, A] = await Promise.all([lire('Z'), lire('A')]);
    return { Z, A };
  }

  /** Début d'un rapport : la fin du dernier de ce type, sinon l'activation, sinon la première facture. */
  private async debutDepuisDernier(organizationId: string, type: 'Z' | 'A'): Promise<Date> {
    const dernier = (await this.derniers(organizationId))[type];
    if (dernier) return new Date(dernier.period_end);
    const { data: p } = await this.db.from('fiscal_profiles').select('activated_at, created_at').eq('organization_id', organizationId).maybeSingle();
    const { data: premiere } = await this.db
      .from('normalized_invoices')
      .select('created_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    const dates = [p?.activated_at, premiere?.created_at, p?.created_at].filter(Boolean).map((d) => new Date(d as string));
    return dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : new Date();
  }

  private async enregistrer(organizationId: string, u: Appelant, type: TypeRapport, seq: number, debut: Date, fin: Date) {
    const data = { ...(await this.entete(organizationId, u)), ...(type === 'A' ? await this.calculA(organizationId, debut, fin) : await this.calculXZ(organizationId, debut, fin)) };
    const { data: r, error } = await this.db
      .from('fiscal_reports')
      .insert({
        organization_id: organizationId,
        report_type: type,
        seq,
        period_start: debut.toISOString(),
        period_end: fin.toISOString(),
        data,
        print_count: 0,
        created_by: u.id,
      })
      .select('*')
      .single();
    if (error) {
      if (error.code === '23505') throw new ConflictException(`Le rapport ${type} n° ${seq} vient d'être fait par quelqu'un d'autre — rouvrez la liste`);
      throw new BadRequestException(error.message);
    }
    return this.vue(r, false);
  }

  /** Mentions de tête (1.3.3 a à f) : dénomination, NIF, ISF, NIM, opérateur. */
  private async entete(organizationId: string, u: Appelant) {
    const [p, { data: fp }, { data: org }, { data: moi }] = await Promise.all([
      this.factures.profil(organizationId),
      this.db.from('fiscal_profiles').select('trade_name, address').eq('organization_id', organizationId).maybeSingle(),
      this.db.from('organizations').select('name, legal_name').eq('id', organizationId).maybeSingle(),
      this.db.from('profiles').select('full_name').eq('id', u.id).maybeSingle(),
    ]);
    let isf: string | null = null;
    try {
      isf = p ? this.factures.isf(p.emcf_environment) : null;
    } catch {
      isf = null;
    }
    return {
      vendeur: { denomination: fp?.trade_name || org?.legal_name || org?.name || '', nif: p?.nif ?? '', adresse: fp?.address ?? '' },
      isf,
      nim: p?.emcf_nim ?? null,
      environnement: p?.emcf_environment ?? 'test',
      operateur: (moi?.full_name as string)?.trim() || 'Gérant',
    };
  }

  private async calculXZ(organizationId: string, debut: Date, fin: Date) {
    const [confirmees, incompletes, mouvements] = await Promise.all([
      this.toutLire<any>(() =>
        this.db
          .from('normalized_invoices')
          .select('id, invoice_type, status, total_cents, vat_cents, reference_type, computed_totals, payments')
          .eq('organization_id', organizationId)
          .eq('status', 'confirmed')
          .gt('confirmed_at', debut.toISOString())
          .lte('confirmed_at', fin.toISOString())
          .order('confirmed_at'),
      ),
      this.toutLire<any>(() =>
        this.db
          .from('normalized_invoices')
          .select('id, invoice_type, status, total_cents, vat_cents')
          .eq('organization_id', organizationId)
          .in('status', ['provisional', 'pending', 'failed'])
          .gt('created_at', debut.toISOString())
          .lte('created_at', fin.toISOString())
          .order('created_at'),
      ),
      this.mouvementsEspeces(organizationId, debut, fin),
    ]);

    // Lignes remisées (prix d'origine) des factures de vente : les réductions commerciales.
    const remisees = new Map<string, FacturePourRapport['lignesRemisees']>();
    for (const l of await this.lignes(confirmees.map((f) => f.id), 'invoice_id, quantity, unit_price_cents, original_price_cents', true)) {
      const liste = remisees.get(l.invoice_id) ?? [];
      liste!.push({ quantite: l.quantity, prixUnitaireCents: Number(l.unit_price_cents), prixOrigineCents: Number(l.original_price_cents) });
      remisees.set(l.invoice_id, liste);
    }
    const factures: FacturePourRapport[] = [...confirmees, ...incompletes].map((f) => ({
      ...f,
      total_cents: f.total_cents == null ? null : Number(f.total_cents),
      vat_cents: f.vat_cents == null ? null : Number(f.vat_cents),
      lignesRemisees: remisees.get(f.id),
    }));
    const contenu = contenuRapportXZ(factures, mouvements);
    return {
      ...contenu,
      totaux: { ventes_cents: contenu.ventes.totalCents, avoirs_cents: contenu.avoirs.totalCents, net_cents: contenu.net.totalCents, tva_cents: contenu.net.tvaCents, factures: contenu.ventes.nombre + contenu.avoirs.nombre },
    };
  }

  private async calculA(organizationId: string, debut: Date, fin: Date) {
    const factures = await this.toutLire<{ id: string; invoice_type: string }>(() =>
      this.db
        .from('normalized_invoices')
        .select('id, invoice_type')
        .eq('organization_id', organizationId)
        .eq('status', 'confirmed')
        .gt('confirmed_at', debut.toISOString())
        .lte('confirmed_at', fin.toISOString())
        .order('confirmed_at'),
    );
    const types = new Map(factures.map((f) => [f.id, f.invoice_type]));
    const lignes = await this.lignes([...types.keys()], 'invoice_id, stock_item_id, code, name, tax_group, unit_price_cents, quantity, line_total_cents', false);
    const pourA: LignePourRapportA[] = lignes.map((l) => ({
      invoice_type: types.get(l.invoice_id) as LignePourRapportA['invoice_type'],
      stock_item_id: l.stock_item_id,
      code: l.code,
      name: l.name,
      tax_group: l.tax_group,
      unit_price_cents: Number(l.unit_price_cents),
      quantity: l.quantity,
      line_total_cents: Number(l.line_total_cents),
    }));
    const ids = [...new Set(pourA.map((l) => l.stock_item_id).filter(Boolean) as string[])];
    const stock: Record<string, number> = {};
    for (let i = 0; i < ids.length; i += LOT) {
      const { data } = await this.db.from('stock_items').select('id, quantity').in('id', ids.slice(i, i + LOT));
      for (const s of data ?? []) stock[s.id] = Number(s.quantity);
    }
    const articles = contenuRapportA(pourA, stock);
    return {
      articles,
      totaux: {
        articles: articles.length,
        vendu_cents: articles.reduce((s, a) => s + a.montantVenduCents, 0),
        retourne_cents: articles.reduce((s, a) => s + a.montantRetourneCents, 0),
        factures: factures.length,
      },
    };
  }

  /** Dépôts et retraits d'espèces des caisses de tous les magasins de l'entreprise (1.10). */
  private async mouvementsEspeces(organizationId: string, debut: Date, fin: Date): Promise<MouvementEspeces[]> {
    const { data: magasins } = await this.db.from('merchants').select('id').eq('organization_id', organizationId);
    const ids = (magasins ?? []).map((m) => m.id);
    const sortie: MouvementEspeces[] = [];
    for (let i = 0; i < ids.length; i += LOT) {
      const lignes = await this.toutLire<any>(() =>
        this.db
          .from('cash_movements')
          .select('id, type, amount_cents, cash_register_sessions!inner(currency, merchant_id)')
          .in('cash_register_sessions.merchant_id', ids.slice(i, i + LOT))
          .gt('created_at', debut.toISOString())
          .lte('created_at', fin.toISOString())
          .order('created_at'),
      );
      for (const m of lignes) sortie.push({ type: m.type, amount_cents: Number(m.amount_cents), currency: m.cash_register_sessions?.currency ?? 'CDF' });
    }
    return sortie;
  }

  /** Lignes des factures données, par lots ; « remiseesSeulement » : celles qui portent un prix d'origine. */
  private async lignes(factureIds: string[], colonnes: string, remiseesSeulement: boolean): Promise<any[]> {
    const sortie: any[] = [];
    for (let i = 0; i < factureIds.length; i += LOT) {
      const lot = factureIds.slice(i, i + LOT);
      sortie.push(
        ...(await this.toutLire<any>(() => {
          let q = this.db.from('normalized_invoice_items').select(colonnes).in('invoice_id', lot);
          if (remiseesSeulement) q = q.not('original_price_cents', 'is', null);
          return q.order('invoice_id').order('line_no');
        })),
      );
    }
    return sortie;
  }

  private async toutLire<T>(requete: () => any): Promise<T[]> {
    const sortie: T[] = [];
    for (let debut = 0; ; debut += PAGE) {
      const { data, error } = await requete().range(debut, debut + PAGE - 1);
      if (error) throw new BadRequestException(error.message);
      sortie.push(...((data ?? []) as T[]));
      if (!data || data.length < PAGE) return sortie;
    }
  }
}
