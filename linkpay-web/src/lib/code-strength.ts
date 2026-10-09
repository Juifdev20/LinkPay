/** Same rules as the API (api/src/app-code/code-strength.ts) — shown live so the user sees why a code is refused. */
export const APP_CODE_LENGTH = 6;

const COMMON = new Set([
  '123456', '654321', '111111', '000000', '123123', '112233', '121212', '123321', '159753', '147258',
  '147369', '258369', '789456', '456789', '101010', '131313', '696969', '666666', '777777', '888888',
  '999999', '555555', '444444', '333333', '222222', '012345', '543210', '246810', '135790', '142536',
  '202020', '200000', '100000', '121314', '112211', '123654', '987654', '987123', '321321', '010203',
]);

/** Returns a French message describing what is wrong, or null if the code is acceptable. */
export function weakAppCodeReason(code: string): string | null {
  if (!new RegExp(`^\\d{${APP_CODE_LENGTH}}$`).test(code)) return `Le code doit comporter exactement ${APP_CODE_LENGTH} chiffres.`;
  if (COMMON.has(code)) return 'Ce code est trop courant. Choisissez-en un moins prévisible.';
  if (new Set(code).size <= 2) return 'Trop de chiffres identiques. Utilisez au moins 3 chiffres différents.';

  const d = [...code].map(Number);
  const steps = d.slice(1).map((n, i) => n - d[i]);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return 'Évitez les suites de chiffres (123456, 654321…).';
  if (code.slice(0, 3) === code.slice(3)) return 'Évitez un motif répété (123123…).';
  if (code.slice(0, 2) === code.slice(2, 4) && code.slice(2, 4) === code.slice(4)) return 'Évitez un motif répété (121212…).';
  // Looks like a date (ddmmyy / mmddyy / yymmdd style) — the first thing tried after the common codes.
  if (/^(0[1-9]|[12]\d|3[01])(0[1-9]|1[0-2])\d\d$/.test(code)) return 'Évitez une date (anniversaire…). Choisissez un code sans signification personnelle.';
  return null;
}
