/**
 * Montant total en lettres, obligatoire sur la facture normalisée (note de service 01/022, 1.2.1 q).
 * Orthographe traditionnelle : traits d'union sous cent (« quarante-trois »), « et » pour 21, 31… 71
 * (« vingt et un », « soixante et onze »), « quatre-vingts » et « deux cents » prennent un s quand rien ne suit,
 * « mille » est invariable, « million » et « milliard » s'accordent.
 */

const UNITES = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix',
  'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf',
];
const DIZAINES = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

/** 0 à 99. `final` : rien ne suit (pour le s de « quatre-vingts »). */
function moinsDeCent(n: number, final: boolean): string {
  if (n < 20) return UNITES[n];
  const d = Math.floor(n / 10);
  let u = n % 10;
  if (d === 7 || d === 9) u += 10; // soixante-dix…, quatre-vingt-dix…
  if (u === 0) return d === 8 ? (final ? 'quatre-vingts' : 'quatre-vingt') : DIZAINES[d];
  if ((u === 1 || u === 11) && d !== 8 && d !== 9) return `${DIZAINES[d]} et ${UNITES[u]}`;
  return `${DIZAINES[d]}-${UNITES[u]}`;
}

/** 0 à 999. */
function moinsDeMille(n: number, final: boolean): string {
  const c = Math.floor(n / 100);
  const reste = n % 100;
  if (c === 0) return moinsDeCent(reste, final);
  const cent = c === 1 ? 'cent' : `${UNITES[c]} cent${reste === 0 && final ? 's' : ''}`;
  return reste === 0 ? cent : `${cent} ${moinsDeCent(reste, final)}`;
}

/** Un entier positif en toutes lettres (jusqu'à 999 999 999 999). */
export function nombreEnLettres(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999_999) throw new Error(`Nombre hors limites : ${n}`);
  if (n === 0) return 'zéro';
  const parties: string[] = [];
  const milliards = Math.floor(n / 1e9);
  const millions = Math.floor((n % 1e9) / 1e6);
  const milliers = Math.floor((n % 1e6) / 1e3);
  const unites = n % 1e3;
  if (milliards) parties.push(`${moinsDeMille(milliards, true)} milliard${milliards > 1 ? 's' : ''}`);
  if (millions) parties.push(`${moinsDeMille(millions, true)} million${millions > 1 ? 's' : ''}`);
  // « mille » et non « un mille » ; « deux cent mille » : cent ne prend pas de s devant mille.
  if (milliers) parties.push(milliers === 1 ? 'mille' : `${moinsDeMille(milliers, false)} mille`);
  if (unites) parties.push(moinsDeMille(unites, true));
  return parties.join(' ');
}

const DEVISES: Record<string, { un: string; plusieurs: string; centime: string; centimes: string }> = {
  CDF: { un: 'franc congolais', plusieurs: 'francs congolais', centime: 'centime', centimes: 'centimes' },
  USD: { un: 'dollar américain', plusieurs: 'dollars américains', centime: 'cent', centimes: 'cents' },
};

/**
 * Montant en centimes → lettres, avec la devise. Ex. 1_160_050 CDF → « onze mille six cents francs congolais et
 * cinquante centimes ». La première lettre est en majuscule, comme sur une facture.
 */
export function montantEnLettres(cents: number, devise: 'CDF' | 'USD' = 'CDF'): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`Montant invalide : ${cents}`);
  const d = DEVISES[devise];
  const entier = Math.floor(cents / 100);
  const reste = cents % 100;
  // « un million de francs », « deux milliards de francs » : « de » quand le nombre finit par million(s)/milliard(s).
  const lettres = nombreEnLettres(entier);
  const de = /(million|milliard)s?$/.test(lettres) ? ' de' : '';
  let texte = `${lettres}${de} ${entier <= 1 ? d.un : d.plusieurs}`;
  if (reste) texte += ` et ${nombreEnLettres(reste)} ${reste === 1 ? d.centime : d.centimes}`;
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}
