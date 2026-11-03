/**
 * Faux e-MCF pour les tests : un vrai serveur HTTP local qui suit le protocole e-MCF v1.3 (statut, demande de
 * facture, confirmation, annulation, détails, demandes en attente, doublon de numéro, refus, jeton invalide), et
 * qu'on peut faire « mal se comporter » : réponse perdue après traitement, montants faux, refus avec code.
 */
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { randomUUID } from 'crypto';
import { calculerTotaux, LigneACalculer } from '../facture-normalisee/calcul';
import { GroupeTaxation, GROUPES, TAUX_2026 } from '../facture-normalisee/groupes';

export interface DemandeEnAttente {
  uid: string;
  rn: string;
  corps: any;
  totaux: Record<string, number>;
  date: string;
}

export class FauxEmcf {
  readonly jetonAttendu = 'jeton-de-test';
  readonly enAttente = new Map<string, DemandeEnAttente>();
  readonly finalisees: (DemandeEnAttente & { codeDEFDGI: string })[] = [];
  readonly annulees: string[] = [];
  /** Traiter la demande puis ne jamais répondre (réponse perdue) — une fois par opération listée. */
  perdreReponse = new Set<'invoice' | 'confirm'>();
  /** Fausser les montants renvoyés (pour tester la comparaison). */
  alterer?: (t: Record<string, number>) => void;
  /** Refuser la prochaine demande de facture avec ce code. */
  refus?: { code: string; desc: string };
  private serveur?: Server;
  private compteur = 0;

  async demarrer(): Promise<string> {
    this.serveur = createServer((req, res) => void this.traiter(req, res));
    await new Promise<void>((ok) => this.serveur!.listen(0, '127.0.0.1', ok));
    return `http://127.0.0.1:${(this.serveur.address() as AddressInfo).port}`;
  }

  async arreter() {
    this.serveur?.closeAllConnections?.();
    await new Promise<void>((ok) => (this.serveur ? this.serveur.close(() => ok()) : ok()));
  }

  private async traiter(req: IncomingMessage, res: ServerResponse) {
    const corps = await lire(req);
    const repondre = (json: unknown, code = 200) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    };
    if (req.headers.authorization !== `Bearer ${this.jetonAttendu}`) return repondre({ message: 'Unauthorized' }, 401);

    const chemin = (req.url ?? '').split('?')[0].replace(/\/+$/, '');
    const m = chemin.match(/^\/api\/invoice(?:\/([^/]+))?(?:\/(CONFIRM|CANCEL))?$/);
    if (chemin.startsWith('/api/info/')) return repondre(chemin.endsWith('taxGroups') ? TAUX_2026 : []);
    if (!m) return repondre({ message: 'Not found' }, 404);
    const [, uid, action] = m;

    if (req.method === 'GET' && !uid) {
      return repondre({
        status: true,
        version: '1.3',
        nif: 'A2216742Y',
        nim: 'TE01000001-1',
        tokenValid: '2027-01-01T00:00:00',
        serverDateTime: new Date().toISOString(),
        pendingRequestsCount: this.enAttente.size,
        pendingRequestsList: [...this.enAttente.values()].map((d) => ({ date: d.date, uid: d.uid })),
      });
    }

    if (req.method === 'POST' && !uid) {
      if (this.refus) {
        const r = this.refus;
        this.refus = undefined;
        return repondre({ uid: null, errorCode: r.code, errorDesc: r.desc });
      }
      if ([...this.enAttente.values()].some((d) => d.rn === corps.rn)) {
        return repondre({ uid: null, errorCode: '63', errorDesc: 'Une demande avec ce numéro est déjà en attente' });
      }
      if (this.enAttente.size >= 10) return repondre({ uid: null, errorCode: '64', errorDesc: 'Trop de demandes en attente' });
      const totaux = calculer(corps);
      this.alterer?.(totaux);
      const d: DemandeEnAttente = { uid: randomUUID(), rn: corps.rn, corps, totaux, date: new Date().toISOString() };
      this.enAttente.set(d.uid, d);
      if (this.perdreReponse.delete('invoice')) return; // traité, mais la réponse ne part jamais
      return repondre({ uid: d.uid, ...totaux });
    }

    if (req.method === 'GET' && uid && !action) {
      const d = this.enAttente.get(uid);
      if (!d) return repondre({ errorCode: '11', errorDesc: "La facture n'existe pas ou elle est déjà finalisée / annulée" });
      const { corps: c } = d;
      return repondre({ nif: c.nif, rn: c.rn, mode: c.mode, isf: c.isf, type: c.type, items: c.items, client: c.client, totals: d.totaux });
    }

    if (req.method === 'PUT' && uid && action) {
      const d = this.enAttente.get(uid);
      if (!d) return repondre({ errorCode: '20', errorDesc: "La facture n'existe pas ou elle est déjà finalisée / annulée" });
      this.enAttente.delete(uid);
      if (action === 'CANCEL') {
        this.annulees.push(uid);
        return repondre({});
      }
      if (Number(corps.total) !== d.totaux.total || Number(corps.vtotal) !== d.totaux.vtotal) {
        this.enAttente.set(uid, d);
        return repondre({ errorCode: '50', errorDesc: 'Le montant TTC déclaré est différent du montant calculé' });
      }
      this.compteur += 1;
      const code = `TEST-${String(this.compteur).padStart(4, '0')}-ABCD-EFGH-IJKL-MNOP`.slice(0, 29);
      this.finalisees.push({ ...d, codeDEFDGI: code });
      if (this.perdreReponse.delete('confirm')) return;
      return repondre({
        dateTime: '03/11/2026 14:44:23',
        qrCode: `RDCDEF01;TE01000001-1;SIG${this.compteur};A2216742Y;20261103144423`,
        codeDEFDGI: code,
        counters: `${this.compteur}/${this.compteur} ${d.corps.type}`,
        nim: 'TE01000001-1',
      });
    }
    return repondre({ message: 'Not found' }, 404);
  }
}

/** Les totaux tels que l'e-MCF les renvoie (ta/taa/haa/vaa par groupe, total, vtotal), en décimal. */
function calculer(corps: any): Record<string, number> {
  const lignes: LigneACalculer[] = (corps.items ?? []).map((i: any) => ({
    prixUnitaireCents: Math.round(Number(i.price) * 100),
    quantite: String(i.quantity),
    groupe: i.taxGroup as GroupeTaxation,
    taxeSpecifiqueCents: i.taxSpecificAmount ? Math.round(Number(i.taxSpecificAmount) * 100) : undefined,
  }));
  const t = calculerTotaux(lignes, corps.mode);
  const r: Record<string, number> = { total: t.totalCents / 100, vtotal: t.tvaCents / 100, ts: t.taxeSpecifiqueCents / 100 };
  for (const g of GROUPES) {
    const x = g.toLowerCase();
    r[`t${x}`] = TAUX_2026[g];
    const tg = t.groupes.find((v) => v.groupe === g);
    r[`ta${x}`] = (tg?.totalCents ?? 0) / 100;
    r[`ha${x}`] = (tg?.baseCents ?? 0) / 100;
    r[`va${x}`] = (tg?.tvaCents ?? 0) / 100;
  }
  return r;
}

function lire(req: IncomingMessage): Promise<any> {
  return new Promise((ok) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => {
      try {
        ok(s ? JSON.parse(s) : {});
      } catch {
        ok({});
      }
    });
  });
}
