/** 0–4 score from length and character variety (same rule as the web strength meter). */
export function treasuryPasswordScore(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(score, 4);
}

/** Why a treasury password is refused, or null when it is strong enough (at least "Moyen"). */
export function treasuryPasswordIssue(password: string): string | null {
  if (!password || password.length < 8) return 'Le mot de passe trésorerie doit comporter au moins 8 caractères.';
  if (password.length > 72) return 'Le mot de passe trésorerie est trop long (72 caractères au plus).';
  if (treasuryPasswordScore(password) < 2) {
    return 'Mot de passe trop faible : ajoutez des majuscules et des minuscules, ou allongez-le (12 caractères).';
  }
  return null;
}
