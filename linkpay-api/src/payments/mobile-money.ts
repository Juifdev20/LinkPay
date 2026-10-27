import { BadRequestException } from '@nestjs/common';

/**
 * Mobile Money numbers of the DR Congo: +243 then 9 digits, the first two (08x / 09x once the national 0 is back)
 * name the network. There is no number portability, so a prefix tells whose line it is. A request goes to the line
 * itself (FlexPaie is not told the operator): someone who picked "Airtel Money" and typed a Vodacom number would
 * receive the confirmation on M-Pesa while our records and the screen said Airtel. Both are therefore checked
 * against each other, here (the API is the authority) and in the web app (to tell the person at once).
 *
 * The prefixes are the ones published for the Congolese networks (several secondary sources agree on them; no
 * regulator table was reachable). A prefix that is NOT in this list is not refused: the payment provider is the
 * last judge, and a wrong table must not lock real customers out.
 */
export type MobileMoneyOperatorId = 'airtel' | 'orange' | 'vodacom' | 'africell';

export const MOBILE_MONEY_OPERATORS: Record<MobileMoneyOperatorId, { label: string; prefixes: string[] }> = {
  vodacom: { label: 'M-Pesa (Vodacom)', prefixes: ['81', '82', '83'] },
  orange: { label: 'Orange Money', prefixes: ['80', '84', '85', '89'] },
  airtel: { label: 'Airtel Money', prefixes: ['97', '98', '99'] },
  africell: { label: 'Africell', prefixes: ['90', '91'] },
};

/** "+243 828 497 218", "0828497218", "243828497218", "828497218", "00243…" → "828497218" (9 digits) or null. */
export function nationalNumber(phone: unknown): string | null {
  let d = String(phone ?? '').replace(/[\s().-]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (!/^\d+$/.test(d)) return null;
  if (d.startsWith('00243')) d = d.slice(5);
  else if (d.startsWith('243') && d.length === 12) d = d.slice(3);
  else if (d.startsWith('0') && d.length === 10) d = d.slice(1);
  return /^[89]\d{8}$/.test(d) ? d : null;
}

/** The network a number belongs to, or null when its prefix is not one we know. */
export function operatorOfNumber(phone: unknown): MobileMoneyOperatorId | null {
  const n = nationalNumber(phone);
  if (!n) return null;
  const prefix = n.slice(0, 2);
  for (const [id, op] of Object.entries(MOBILE_MONEY_OPERATORS)) if (op.prefixes.includes(prefix)) return id as MobileMoneyOperatorId;
  return null;
}

/** Refuses a number that is malformed, or that clearly belongs to another network than the chosen one. */
export function assertNumberMatchesOperator(operator: string | undefined | null, phone: unknown): void {
  if (nationalNumber(phone) === null) {
    throw new BadRequestException('Numéro de téléphone invalide. Exemple : 0828 497 218 ou +243 828 497 218.');
  }
  const chosen = operator ? MOBILE_MONEY_OPERATORS[operator as MobileMoneyOperatorId] : undefined;
  if (!chosen) return; // no (or an unknown) operator named: nothing to compare with
  const actual = operatorOfNumber(phone);
  if (actual && actual !== operator) {
    const found = MOBILE_MONEY_OPERATORS[actual];
    throw new BadRequestException(`Ce numéro est un numéro ${found.label}, pas ${chosen.label}. Choisissez ${found.label} ou saisissez un numéro ${chosen.label}.`);
  }
}

/**
 * Turns what the payment provider (FlexPaie / the operator) said when it REFUSED to start a Mobile Money payment into a sentence that tells
 * the payer what to do. The provider's own wording is technical, in French or English, and often just "failed": the person only needs to
 * know whether it is his balance, his PIN, his number, a limit, or the operator's network. Order matters: balance first (the most common).
 * What we cannot recognise is passed through unchanged (it is usually already a readable French sentence, e.g. the minimum amount).
 */
export function explainMobileMoneyRefusal(providerMessage: string | undefined | null, phone?: unknown): string {
  const raw = String(providerMessage ?? '').trim();
  const operator = operatorOfNumber(phone);
  const account = operator ? MOBILE_MONEY_OPERATORS[operator].label : 'Mobile Money';
  const m = raw.toLowerCase();

  // About OUR merchant account at the provider, not the payer's: the payer can do nothing about it, so his balance is not blamed.
  if (/marchand|merchant/.test(m)) return raw;
  if (/insuffisan|insufficient|not enough|solde|balance|fonds|funds|low credit|crédit/.test(m)) {
    return `Solde insuffisant : votre compte ${account} n'a pas assez d'argent pour ce paiement (le montant et les frais de l'opérateur sont à prévoir). Rechargez votre compte ${account} ou choisissez un montant plus petit, puis réessayez.`;
  }
  if (/\bpin\b|code secret|mot de passe|password|wrong code|invalid code|code incorrect|code erron/.test(m)) {
    return `Le code PIN ${account} n'est pas correct. Vérifiez-le puis réessayez ; après plusieurs erreurs, l'opérateur bloque le compte quelques minutes.`;
  }
  if (/limit|plafond|maximum|exceed|dépass|depass/.test(m) && !/minimal|minimum|inférieur|inferieur/.test(m)) {
    return `Ce paiement dépasse la limite de votre compte ${account} (par opération ou par jour). Essayez un montant plus petit, ou contactez ${account}.`;
  }
  if (/not registered|unregistered|inconnu|unknown|non enregistr|invalid (number|account|msisdn|subscriber)|numéro invalide|numero invalide|subscriber|inactive|inactif|blocked|bloqu|suspend|barred/.test(m)) {
    return `Ce numéro n'est pas reconnu comme un compte ${account} actif. Vérifiez le numéro (c'est celui de votre compte ${account}) et que votre compte n'est pas bloqué ou suspendu.`;
  }
  if (/timeout|time out|timed out|délai|delai|expired|expir|busy|occup|indisponible|unavailable|try again|réessay|reessay|network|réseau|reseau/.test(m)) {
    return `Le réseau ${account} est momentanément occupé ou n'a pas répondu à temps. Patientez une minute puis réessayez.`;
  }
  return raw || `Le paiement ${account} n'a pas pu être lancé. Vérifiez votre solde ${account}, votre numéro, puis réessayez.`;
}

/**
 * Said when a Mobile Money payment that WAS started comes back as failed: the status check only says "failed", never why. So the message
 * lists the usual causes, most likely first, and states that nothing was debited.
 */
export function mobileMoneyFailedAdvice(phone?: unknown): string {
  const operator = operatorOfNumber(phone);
  const account = operator ? MOBILE_MONEY_OPERATORS[operator].label : 'Mobile Money';
  return (
    `Le paiement ${account} n'a pas abouti. Aucun montant n'a été débité. Vérifiez : 1) que votre solde ${account} est suffisant (montant + frais de l'opérateur) ; ` +
    `2) que vous avez saisi le bon code PIN, dans le délai demandé ; 3) que le numéro est bien celui de votre compte ${account}. Puis réessayez.`
  );
}
