/** Facture normalisée (DGI) — ce que les écrans partagent. Voir linkpay-api/src/facture-normalisee. */

export type TypeClient = 'PP' | 'PM' | 'PC' | 'PL' | 'AO';

export interface ClientFiscal {
  type: TypeClient;
  nom?: string;
  nif?: string;
  contact?: string;
  adresse?: string;
  referenceExoneration?: string;
}

export const TYPES_CLIENT: { type: TypeClient; libelle: string; court: string }[] = [
  { type: 'PP', libelle: 'Personne physique', court: 'Particulier' },
  { type: 'PM', libelle: 'Personne morale', court: 'Entreprise' },
  { type: 'PC', libelle: 'Personne physique commerçante', court: 'Commerçant' },
  { type: 'PL', libelle: 'Profession libérale', court: 'Profession libérale' },
  { type: 'AO', libelle: 'Ambassades et organisations internationales', court: 'Ambassade / ONG' },
];

/** Ce que la DGI exige pour chaque type de client (cas de test SFE). */
export function erreurClient(c: ClientFiscal): string | null {
  if (c.type === 'PP') return null;
  if (!c.nom?.trim()) return 'Le nom du client est obligatoire';
  if ((c.type === 'PM' || c.type === 'PC' || c.type === 'PL') && !/^[A-Z0-9]{9}$/.test((c.nif ?? '').trim().toUpperCase())) {
    return 'Le NIF du client est obligatoire (9 caractères, ex. A2216742Y)';
  }
  if (c.type === 'AO' && !c.referenceExoneration?.trim()) return "La référence du certificat d'exonération est obligatoire";
  return null;
}

export const STATUTS: Record<string, { libelle: string; ton: 'ok' | 'attente' | 'erreur' | 'neutre' }> = {
  confirmed: { libelle: 'Normalisée', ton: 'ok' },
  provisional: { libelle: 'Bon provisoire', ton: 'attente' },
  pending: { libelle: 'En cours', ton: 'attente' },
  failed: { libelle: 'À traiter', ton: 'erreur' },
  abandoned: { libelle: 'Abandonnée', ton: 'neutre' },
};

export const TONS: Record<string, string> = {
  ok: 'bg-success/10 text-success',
  attente: 'bg-warning/10 text-warning',
  erreur: 'bg-destructive/10 text-destructive',
  neutre: 'bg-muted text-muted-foreground',
};

/** Le message de l'API, avec la liste des règles DGI non respectées quand il y en a. */
export function messageErreur(err: any, defaut = 'Une erreur est survenue'): string {
  const d = err?.response?.data;
  const liste = d?.erreurs ?? d?.message?.erreurs;
  if (Array.isArray(liste) && liste.length) return liste.join(' • ');
  const m = d?.message;
  if (typeof m === 'string') return m;
  if (Array.isArray(m)) return m.join(' • ');
  if (typeof m?.message === 'string') return m.message;
  return defaut;
}
