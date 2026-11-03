/**
 * Client de l'API e-MCF v1.3 de la DGI (docs/FACTURE_NORMALISEE.md, « L'API e-MCF »).
 *
 *   GET  {facturation}/                 état de l'e-MCF (jeton valide, demandes en attente)
 *   POST {facturation}/                 demande de facture → uid + montants calculés par l'e-MCF
 *   PUT  {facturation}/{uid}/CONFIRM    finalisation → éléments de sécurité (code DEF/DGI, QR, compteurs)
 *   PUT  {facturation}/{uid}/CANCEL     abandon d'une demande en attente
 *   GET  {facturation}/{uid}            détails d'une demande en attente
 *   GET  {information}/{ressource}      status, taxGroups, invoiceTypes, paymentTypes, clientTypes, currencyRates…
 *
 * Bonnes pratiques de la DGI appliquées : attendre 10 s une réponse, puis conclure à une absence de réponse ;
 * conserver la date, l'heure et le contenu de CHAQUE demande et réponse (le journal) ; remonter à l'utilisateur le
 * code et la description de l'erreur renvoyés par l'e-MCF. Le jeton n'est jamais écrit dans le journal.
 */

export type EnvironnementEmcf = 'test' | 'production';

export const RACINES_EMCF: Record<EnvironnementEmcf, string> = {
  production: 'https://edef.dgirdc.cd',
  test: 'https://developper.dgirdc.cd/edef',
};

/** 10 secondes au moins (bonne pratique DGI). */
export const DELAI_EMCF_MS = 10_000;

export type OperationEmcf = 'status' | 'invoice' | 'confirm' | 'cancel' | 'details' | 'info';

export interface EchangeEmcf {
  operation: OperationEmcf;
  http_method: string;
  path: string;
  request_body: unknown;
  http_status: number | null;
  response_body: unknown;
  error: string | null;
  duration_ms: number;
}

export type Journaliser = (e: EchangeEmcf) => Promise<void> | void;

export type GenreErreurEmcf = 'reseau' | 'delai' | 'jeton' | 'http' | 'refus' | 'reponse';

/** Toute erreur de l'e-MCF, avec un message en français affichable au caissier. */
export class ErreurEmcf extends Error {
  constructor(
    readonly genre: GenreErreurEmcf,
    message: string,
    /** Code et description renvoyés par l'e-MCF (genre « refus »). */
    readonly code?: string,
    readonly description?: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'ErreurEmcf';
  }

  /** La demande n'a peut-être pas atteint l'e-MCF, ou sa réponse s'est perdue : à vérifier avant de renvoyer. */
  get incertaine() {
    return this.genre === 'delai' || this.genre === 'reseau';
  }
}

// --- Réponses (champs de l'API v1.3)

export interface StatutEmcf {
  status: boolean;
  version?: string;
  nif?: string;
  nim?: string;
  tokenValid?: string;
  serverDateTime?: string;
  pendingRequestsCount?: number;
  pendingRequestsList?: { date: string; uid: string }[];
}

/** Réponse à la demande de facture : uid + ta..tp (taux), taa..tap (total), haa..hap (HT), vaa..vap (TVA)… */
export interface ReponseDemandeFacture {
  uid: string;
  total: number;
  vtotal: number;
  ts?: number;
  curTotal?: number;
  [champ: string]: unknown;
}

export interface ReponseFinalisation {
  dateTime: string;
  qrCode: string;
  codeDEFDGI: string;
  counters: string;
  nim: string;
}

export class EmcfClient {
  private readonly facturation: string;
  private readonly urlInformation: string;

  constructor(
    private readonly options: {
      environnement: EnvironnementEmcf;
      jeton: string;
      journaliser?: Journaliser;
      /** Racine différente (faux serveur des tests, ou nouvelle adresse publiée par la DGI). */
      racine?: string;
      delaiMs?: number;
    },
  ) {
    const racine = (options.racine || RACINES_EMCF[options.environnement]).replace(/\/+$/, '');
    this.facturation = `${racine}/api/invoice`;
    this.urlInformation = `${racine}/api/info`;
    if (!options.jeton?.trim()) throw new ErreurEmcf('jeton', "Aucun jeton e-MCF n'est enregistré pour cette entreprise");
  }

  statut() {
    return this.appel<StatutEmcf>('status', 'GET', this.facturation);
  }

  demanderFacture(requete: Record<string, unknown>) {
    return this.appel<ReponseDemandeFacture>('invoice', 'POST', this.facturation, requete);
  }

  confirmer(uid: string, montants: { total: number; vtotal: number }) {
    return this.appel<ReponseFinalisation>('confirm', 'PUT', `${this.facturation}/${encodeURIComponent(uid)}/CONFIRM`, montants);
  }

  annuler(uid: string) {
    return this.appel<Record<string, unknown>>('cancel', 'PUT', `${this.facturation}/${encodeURIComponent(uid)}/CANCEL`);
  }

  details(uid: string) {
    return this.appel<Record<string, any>>('details', 'GET', `${this.facturation}/${encodeURIComponent(uid)}`);
  }

  information<T = unknown>(ressource: 'status' | 'taxGroups' | 'invoiceTypes' | 'paymentTypes' | 'clientTypes' | 'referenceTypes' | 'itemTypes' | 'currencyRates') {
    return this.appel<T>('info', 'GET', `${this.urlInformation}/${ressource}`);
  }

  private async appel<T>(operation: OperationEmcf, methode: 'GET' | 'POST' | 'PUT', url: string, corps?: unknown): Promise<T> {
    const debut = Date.now();
    const chemin = new URL(url).pathname;
    const echange: EchangeEmcf = {
      operation,
      http_method: methode,
      path: chemin,
      request_body: corps ?? null,
      http_status: null,
      response_body: null,
      error: null,
      duration_ms: 0,
    };
    const controleur = new AbortController();
    const minuterie = setTimeout(() => controleur.abort(), this.options.delaiMs ?? DELAI_EMCF_MS);
    try {
      let reponse: Response;
      try {
        reponse = await fetch(url, {
          method: methode,
          headers: {
            Authorization: `Bearer ${this.options.jeton.trim().replace(/^bearer\s+/i, '')}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: corps === undefined ? undefined : JSON.stringify(corps),
          signal: controleur.signal,
        });
      } catch (err: any) {
        const delai = err?.name === 'AbortError';
        echange.error = delai ? 'délai dépassé' : `réseau : ${err?.cause?.code || err?.message || 'inconnu'}`;
        throw new ErreurEmcf(
          delai ? 'delai' : 'reseau',
          delai
            ? "La DGI n'a pas répondu à temps (10 s). Vérification en cours avant tout nouvel envoi."
            : 'Impossible de joindre le serveur de la DGI (réseau indisponible).',
        );
      }
      echange.http_status = reponse.status;
      const texte = await reponse.text().catch(() => '');
      let json: any = null;
      try {
        json = texte ? JSON.parse(texte) : null;
      } catch {
        echange.response_body = { brut: texte.slice(0, 2000) };
      }
      if (json !== null) echange.response_body = json;
      if (reponse.status === 401) {
        throw new ErreurEmcf('jeton', 'Le jeton e-MCF est refusé par la DGI (expiré ou invalide). Créez-en un nouveau sur le portail e-DEF.', undefined, undefined, 401);
      }
      // L'e-MCF signale ses refus par errorCode / errorDesc, avec ou sans code HTTP d'erreur.
      if (json && json.errorCode !== undefined && json.errorCode !== null && String(json.errorCode) !== '' && String(json.errorCode) !== '0') {
        const code = String(json.errorCode);
        const description = String(json.errorDesc ?? '').trim();
        echange.error = `refus ${code}`;
        throw new ErreurEmcf('refus', `La DGI a refusé la facture (code ${code}${description ? ` : ${description}` : ''})`, code, description, reponse.status);
      }
      if (!reponse.ok) {
        throw new ErreurEmcf('http', `Le serveur de la DGI a répondu par une erreur (HTTP ${reponse.status})`, undefined, undefined, reponse.status);
      }
      if (json === null) throw new ErreurEmcf('reponse', "La réponse de la DGI n'est pas lisible", undefined, undefined, reponse.status);
      return json as T;
    } finally {
      clearTimeout(minuterie);
      echange.duration_ms = Date.now() - debut;
      try {
        await this.options.journaliser?.(echange);
      } catch {
        // Le journal ne doit jamais faire échouer l'échange lui-même ; l'appelant journalise aussi l'erreur finale.
      }
    }
  }
}
