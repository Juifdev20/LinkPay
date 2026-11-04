import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { WalletPinService } from '../wallets/wallet-pin.service';
import { calculerTotaux, ModePrix } from './calcul';
import {
  articlesDuCas,
  CAMPAGNE_VALIDE,
  CAS_TESTS_DGI,
  CasTestDgi,
  clientDuCas,
  ClientsTest,
  groupesManquants,
  sourceDuCas,
} from './cas-tests-dgi';
import { FactureNormaliseeService, ProfilFiscal, VueFacture } from './facture-normalisee.service';
import { Appelant, GestionFiscaleService } from './gestion-fiscale.service';
import { estAvoir, GROUPES_HOMOLOGUES, GroupeTaxation, LIBELLES_TYPES_FACTURE } from './groupes';
import { ArticleFacture, NIF_VALIDE } from './validation';

export type EtatCas = 'a_faire' | 'reussi' | 'echec' | 'a_verifier' | 'en_attente' | 'hors_perimetre';

export interface ResultatCas {
  num: number;
  mode: ModePrix;
  etat: EtatCas;
  facture: (VueFacture & { created_at?: string }) | null;
  message?: string;
}

const COLONNES =
  'id, rn, invoice_type, status, total_cents, vat_cents, code_def_dgi, qr_code, counters, nim, emcf_datetime, last_error_code, last_error_desc, created_at';

/**
 * Les cas de test de l'homologation rejoués sur l'e-MCF de TEST (document « Cas de test SFE » v1.2) : un cas à la fois,
 * en TTC ou en HT, dans une « campagne » (une série complète). Chaque cas devient une vraie facture normalisée de test,
 * avec ses éléments de sécurité, à photographier et à vérifier sur le site de vérification de la DGI. Patron et
 * gérants seulement ; jamais en production.
 */
@Injectable()
export class TestsDgiService {
  constructor(
    private supabase: SupabaseService,
    private factures: FactureNormaliseeService,
    private gestion: GestionFiscaleService,
    private pins: WalletPinService,
  ) {}

  private get db() {
    return this.supabase.getClient();
  }

  private async preparer(organizationId: string, u: Appelant): Promise<ProfilFiscal> {
    if ((await this.gestion.droits(organizationId, u)) !== 'gestion') {
      throw new ForbiddenException('Les tests DGI sont réservés au patron et aux gérants');
    }
    const p = await this.factures.profil(organizationId);
    if (!p) throw new BadRequestException("Enregistrez d'abord le profil fiscal de l'entreprise");
    return p;
  }

  private autorises(p: ProfilFiscal): readonly GroupeTaxation[] {
    return p.allowed_tax_groups?.length ? p.allowed_tax_groups : GROUPES_HOMOLOGUES;
  }

  /** Le catalogue, ce qui manque pour commencer, et les campagnes déjà faites. */
  async etat(organizationId: string, u: Appelant) {
    const p = await this.preparer(organizationId, u);
    const autorises = this.autorises(p);
    const { data } = await this.db
      .from('normalized_invoices')
      .select('source_id, created_at')
      .eq('organization_id', organizationId)
      .eq('source_type', 'manual')
      .like('source_id', 'dgi-test:%')
      .order('created_at', { ascending: false })
      .limit(2000);
    const campagnes = new Map<string, { campagne: string; factures: number; derniere: string }>();
    for (const r of data ?? []) {
      const nom = String(r.source_id).split(':')[1];
      const c = campagnes.get(nom) ?? { campagne: nom, factures: 0, derniere: r.created_at };
      c.factures += 1;
      campagnes.set(nom, c);
    }
    const prets = [
      !p.nif && 'Enregistrez le NIF de l’entreprise',
      !p.emcf_token_encrypted && 'Enregistrez le jeton e-MCF de test (portail e-DEF de la DGI)',
      !p.enabled && 'Activez la facture normalisée',
      p.emcf_environment !== 'test' && 'Les tests se font sur l’e-MCF de TEST : repassez l’environnement en « test »',
    ].filter(Boolean) as string[];
    return {
      pret: prets.length === 0,
      manque: prets,
      nif: p.nif,
      environnement: p.emcf_environment,
      groupes: autorises,
      cas: CAS_TESTS_DGI.map((c) => {
        const manquants = groupesManquants(c, autorises);
        return {
          num: c.num,
          titre: c.titre,
          type: c.type,
          type_libelle: LIBELLES_TYPES_FACTURE[c.type],
          client: c.client,
          articles: c.articles.map((x) => `${x.quantite.replace('.', ',')} × ${x.groupe}`).join(', '),
          a_verifier: c.aVerifier,
          origine: c.avoir?.origine ?? null,
          avoir: !!c.avoir,
          hors_perimetre: manquants.length ? `Groupe${manquants.length > 1 ? 's' : ''} ${manquants.join(', ')} non déclaré${manquants.length > 1 ? 's' : ''}` : null,
        };
      }),
      campagnes: [...campagnes.values()],
    };
  }

  /** Où en est chaque cas d'une campagne, dans les deux modes. */
  async resultats(organizationId: string, u: Appelant, campagne: string) {
    const p = await this.preparer(organizationId, u);
    if (!CAMPAGNE_VALIDE.test(campagne)) throw new BadRequestException('Nom de campagne invalide');
    const { data } = await this.db
      .from('normalized_invoices')
      .select(`${COLONNES}, source_id`)
      .eq('organization_id', organizationId)
      .eq('source_type', 'manual')
      .like('source_id', `dgi-test:${campagne}:%`)
      .neq('status', 'abandoned')
      .order('created_at', { ascending: false });
    const parSource = new Map<string, any>();
    for (const f of data ?? []) if (!parSource.has(f.source_id)) parSource.set(f.source_id, f);
    const autorises = this.autorises(p);
    const resultats: ResultatCas[] = [];
    for (const mode of ['ttc', 'ht'] as const) {
      for (const c of CAS_TESTS_DGI) {
        const f = parSource.get(sourceDuCas(campagne, mode, c.num)) ?? null;
        resultats.push(this.resultat(c, mode, f, groupesManquants(c, autorises).length > 0));
      }
    }
    return { campagne, resultats };
  }

  private resultat(c: CasTestDgi, mode: ModePrix, f: any, horsPerimetre: boolean): ResultatCas {
    if (!f) return { num: c.num, mode, etat: horsPerimetre ? 'hors_perimetre' : 'a_faire', facture: null };
    const { source_id: _s, ...facture } = f;
    const etat: EtatCas =
      f.status === 'confirmed' ? 'reussi' : f.last_error_code === 'A_VERIFIER' ? 'a_verifier' : f.status === 'failed' ? 'echec' : 'en_attente';
    return { num: c.num, mode, etat, facture, message: f.last_error_desc ?? undefined };
  }

  private async trouver(organizationId: string, source: string) {
    const { data } = await this.db
      .from('normalized_invoices')
      .select(COLONNES)
      .eq('organization_id', organizationId)
      .eq('source_type', 'manual')
      .eq('source_id', source)
      .neq('status', 'abandoned')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data as (VueFacture & { created_at: string }) | null;
  }

  /**
   * Joue un cas : crée sa facture et la fait normaliser par l'e-MCF de test. Un cas déjà réussi n'est pas refait ; un
   * cas en échec ou en attente est simplement retenté (même numéro). Un avoir demande le code PIN.
   */
  async jouer(
    organizationId: string,
    u: Appelant,
    d: { campagne: string; mode: ModePrix; num: number; pin?: string; clients?: Partial<ClientsTest> },
  ): Promise<ResultatCas> {
    const p = await this.preparer(organizationId, u);
    if (p.emcf_environment !== 'test') throw new ForbiddenException('Les cas de test se font seulement sur l’e-MCF de TEST');
    if (!p.enabled || !p.nif) throw new BadRequestException("La facture normalisée n'est pas activée pour cette entreprise");
    if (!CAMPAGNE_VALIDE.test(d.campagne)) throw new BadRequestException('Nom de campagne invalide');
    const c = CAS_TESTS_DGI.find((x) => x.num === d.num);
    if (!c) throw new NotFoundException('Cas de test inconnu');
    const manquants = groupesManquants(c, this.autorises(p));
    if (manquants.length) {
      throw new BadRequestException(`Cas hors périmètre : groupe(s) ${manquants.join(', ')} non déclaré(s) à l'homologation`);
    }

    const source = sourceDuCas(d.campagne, d.mode, c.num);
    const existante = await this.trouver(organizationId, source);
    if (existante) {
      if (existante.status === 'confirmed' || existante.last_error_code === 'A_VERIFIER') return this.resultat(c, d.mode, existante, false);
      if (existante.status !== 'failed') {
        // Bon provisoire ou demande en cours (réseau) : on la renvoie telle quelle.
        const v = await this.factures.tenter(existante.id);
        return this.resultat(c, d.mode, { ...existante, ...v }, false);
      }
      // Refusée par la DGI : renvoyer la même demande donnerait le même refus. On range l'ancienne (elle reste dans le
      // journal, « abandonnée ») et on refait la facture avec la version actuelle de ScanLinkPay.
      await this.db.from('normalized_invoices').update({ status: 'abandoned' }).eq('id', existante.id);
    }

    let articles: ArticleFacture[] = articlesDuCas(c);
    let factureOrigineId: string | undefined;
    if (c.avoir) {
      if (!d.pin) throw new BadRequestException('Un avoir demande votre code PIN');
      await this.pins.verifyPin(u.id, d.pin);
      if (c.avoir.origine) {
        const origine = await this.trouver(organizationId, sourceDuCas(d.campagne, d.mode, c.avoir.origine));
        if (!origine || origine.status !== 'confirmed') {
          throw new BadRequestException(`Faites d'abord le cas n° ${c.avoir.origine} (sa facture de vente doit être normalisée)`);
        }
        factureOrigineId = origine.id;
        const { data: lignes } = await this.db.from('normalized_invoice_items').select('*').eq('invoice_id', origine.id).order('line_no');
        const choix = c.avoir.lignes ?? (lignes ?? []).map((l: any) => ({ ligne: l.line_no as number, quantite: String(l.quantity) }));
        articles = choix.map((x) => {
          const l: any = (lignes ?? []).find((y: any) => y.line_no === x.ligne);
          if (!l) throw new BadRequestException(`Ligne ${x.ligne} absente de la facture d'origine`);
          return {
            nom: l.name,
            code: l.code ?? undefined,
            type: l.item_type,
            groupe: l.tax_group,
            prixUnitaireCents: Number(l.unit_price_cents),
            quantite: x.quantite,
            ligneOrigineId: l.id,
          };
        });
      }
    }

    const clients: ClientsTest = { nif: (d.clients?.nif || p.nif).trim().toUpperCase(), ...d.clients };
    clients.nif = clients.nif.trim().toUpperCase();
    if (!NIF_VALIDE.test(clients.nif)) throw new BadRequestException('NIF du client de test invalide (9 caractères)');

    let devise: { code: 'USD'; taux: string } | undefined;
    if (c.equivalentUsd) {
      const taux = await this.gestion.tauxUsd(p);
      if (!taux) throw new BadRequestException("Taux du dollar indisponible auprès de l'e-MCF : réessayez dans un instant");
      devise = { code: 'USD', taux };
    }

    const total = calculerTotaux(articles, d.mode).totalCents;
    const { data: moi } = await this.db.from('profiles').select('full_name').eq('id', u.id).maybeSingle();
    const v = await this.factures.emettre({
      organizationId,
      source: { type: 'manual', id: source },
      facture: {
        type: c.type,
        articles,
        client: clientDuCas(c, clients),
        paiements: [{ moyen: c.moyen ?? 'ESPECES', montantCents: total }],
        avoir: estAvoir(c.type) ? { nature: c.avoir!.nature } : undefined,
      },
      mode: d.mode,
      factureOrigineId,
      devise,
      operateur: { id: u.id, nom: (moi?.full_name as string)?.trim() || 'Gérant' },
      userId: u.id,
    });
    return this.resultat(c, d.mode, v, false);
  }
}
