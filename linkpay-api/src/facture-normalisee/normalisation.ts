/**
 * Le déroulé d'une normalisation (flux de la DGI, API e-MCF v1.3), indépendant de la base de données :
 *
 *   1. demande de facture (POST) → uid + montants calculés par l'e-MCF ;
 *   2. comparaison avec NOTRE calcul ; s'ils diffèrent → annulation (CANCEL), aucune facture n'est émise ;
 *   3. confirmation (PUT …/CONFIRM) → éléments de sécurité (code DEF/DGI, QR, compteurs, NIM, date et heure).
 *
 * Réseau coupé ou réponse perdue (« pas de réponse au bout de 10 s ») : on ne renvoie JAMAIS à l'aveugle. On relit
 * l'état de l'e-MCF (demandes en attente) et le détail de chacune pour retrouver NOTRE numéro de facture (rn) ; si
 * elle y est, on reprend là où on s'était arrêté. Une demande non finalisée expire au bout de 2 minutes côté DGI.
 */
import { TotauxFacture } from './calcul';
import { EmcfClient, ErreurEmcf, ReponseDemandeFacture, ReponseFinalisation } from './emcf.client';
import { comparerMontants, EcartMontant, montantsDeConfirmation } from './requete';

export type IssueNormalisation =
  /** Normalisée : la facture peut être imprimée avec ses éléments de sécurité. */
  | { statut: 'confirmee'; uid: string; montantsDgi: ReponseDemandeFacture; elements: ReponseFinalisation }
  /** La DGI a refusé (code et description à montrer au caissier) — à corriger avant tout nouvel envoi. */
  | { statut: 'refusee'; erreur: ErreurEmcf; uid?: string }
  /** Montants différents des nôtres : demande annulée. Signale une erreur de calcul à examiner. */
  | { statut: 'ecart'; uid: string; ecarts: EcartMontant[]; montantsDgi: ReponseDemandeFacture }
  /** DGI injoignable, rien n'est en attente chez elle : bon provisoire, nouvel essai plus tard. */
  | { statut: 'injoignable'; erreur: ErreurEmcf }
  /** Confirmation envoyée sans réponse sûre : à vérifier (site de vérification de la DGI) avant toute autre action. */
  | { statut: 'a_verifier'; uid: string; erreur: ErreurEmcf; montantsDgi: ReponseDemandeFacture };

/** Code e-MCF « une demande avec ce numéro est déjà en attente » (annexe des erreurs). */
const CODE_DOUBLON_EN_ATTENTE = '63';

export async function normaliser(
  client: EmcfClient,
  requete: Record<string, unknown>,
  nosTotaux: TotauxFacture,
  options: { uidEnAttente?: string | null } = {},
): Promise<IssueNormalisation> {
  const rn = String(requete.rn ?? '');

  // 0. Une tentative précédente avait déjà obtenu un uid : on la reprend si elle est toujours en attente.
  let demande: ReponseDemandeFacture | null = null;
  if (options.uidEnAttente) demande = await relireDemande(client, options.uidEnAttente, rn);

  // 1. Demande de facture.
  if (!demande) {
    try {
      demande = await client.demanderFacture(requete);
    } catch (e) {
      const erreur = e as ErreurEmcf;
      if (!(erreur instanceof ErreurEmcf)) throw e;
      const doublon = erreur.genre === 'refus' && erreur.code === CODE_DOUBLON_EN_ATTENTE;
      if (erreur.incertaine || doublon) {
        // La demande est peut-être arrivée : on la cherche parmi les demandes en attente avant tout renvoi.
        demande = await retrouverDemandeEnAttente(client, rn);
        if (!demande) {
          return doublon ? { statut: 'refusee', erreur } : { statut: 'injoignable', erreur };
        }
      } else {
        return { statut: 'refusee', erreur };
      }
    }
  }
  if (!demande?.uid) {
    return { statut: 'refusee', erreur: new ErreurEmcf('reponse', "La DGI n'a pas renvoyé d'identifiant de demande (uid)") };
  }

  // 2. Nos montants contre les siens.
  const ecarts = comparerMontants(nosTotaux, demande);
  if (ecarts.length) {
    await client.annuler(demande.uid).catch(() => undefined); // sinon elle expire seule au bout de 2 minutes
    return { statut: 'ecart', uid: demande.uid, ecarts, montantsDgi: demande };
  }

  // 3. Confirmation (une seule nouvelle tentative si la réponse se perd).
  const montants = montantsDeConfirmation(demande);
  for (let essai = 1; essai <= 2; essai++) {
    try {
      const elements = await client.confirmer(demande.uid, montants);
      if (!elements?.codeDEFDGI || !elements?.qrCode) {
        return {
          statut: 'a_verifier',
          uid: demande.uid,
          montantsDgi: demande,
          erreur: new ErreurEmcf('reponse', 'La DGI a confirmé sans renvoyer le code DEF/DGI ou le code QR'),
        };
      }
      return { statut: 'confirmee', uid: demande.uid, montantsDgi: demande, elements };
    } catch (e) {
      const erreur = e as ErreurEmcf;
      if (!(erreur instanceof ErreurEmcf)) throw e;
      if (erreur.incertaine && essai === 1) continue;
      if (erreur.incertaine || essai === 2) return { statut: 'a_verifier', uid: demande.uid, erreur, montantsDgi: demande };
      return { statut: 'refusee', erreur, uid: demande.uid };
    }
  }
  /* istanbul ignore next */
  throw new Error('inaccessible');
}

/** Détail d'une demande en attente, si elle porte bien notre numéro ; sinon null (expirée, finalisée, autre). */
async function relireDemande(client: EmcfClient, uid: string, rn: string): Promise<ReponseDemandeFacture | null> {
  try {
    const d = await client.details(uid);
    if (String(d?.rn ?? '') !== rn) return null;
    const totaux = (d.totals ?? {}) as Record<string, unknown>;
    return { ...totaux, uid } as ReponseDemandeFacture;
  } catch {
    return null;
  }
}

async function retrouverDemandeEnAttente(client: EmcfClient, rn: string): Promise<ReponseDemandeFacture | null> {
  let enAttente: { uid: string }[] = [];
  try {
    enAttente = (await client.statut()).pendingRequestsList ?? [];
  } catch {
    return null;
  }
  for (const { uid } of enAttente) {
    const d = await relireDemande(client, uid, rn);
    if (d) return d;
  }
  return null;
}
