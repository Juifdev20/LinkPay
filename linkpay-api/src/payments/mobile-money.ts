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
