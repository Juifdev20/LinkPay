import { ForbiddenException, Logger, ServiceUnavailableException } from '@nestjs/common';

/** How long no money may leave an account after its password, PIN, phone or email changed (migration 068). */
export const SECURITY_HOLD_MS = 24 * 3_600_000;

const logger = new Logger('SecurityHold');

/**
 * Refuses an operation that sends money out of the account of `userId` (withdrawal, transfer, wallet payment,
 * merchant refund) during the 24 hours after one of its keys changed: someone who took the account over cannot
 * empty it at once, and the real owner has time to react. Unreadable = refused (never let through unchecked).
 */
export async function assertNoRecentSecurityChange(client: any, userId: string, now: number = Date.now()): Promise<void> {
  const { data, error } = await client.from('profiles').select('security_changed_at').eq('id', userId).maybeSingle();
  if (error) {
    if (/security_changed_at/i.test(String(error.message))) {
      logger.warn('profiles.security_changed_at is missing (apply migration 068): the 24 h hold is not enforced');
      return;
    }
    throw new ServiceUnavailableException("L'opération est momentanément indisponible. Réessayez dans quelques minutes.");
  }
  const changedAt = data?.security_changed_at ? Date.parse(data.security_changed_at) : NaN;
  if (!Number.isFinite(changedAt) || now - changedAt >= SECURITY_HOLD_MS) return;

  const until = new Date(changedAt + SECURITY_HOLD_MS).toLocaleString('fr-FR', {
    timeZone: 'Africa/Lubumbashi', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  throw new ForbiddenException(
    `Pour votre sécurité, aucun argent ne peut sortir du compte pendant 24 h après un changement de mot de passe, de code PIN, de numéro de téléphone ou d'e-mail. Possible à partir du ${until}. Si vous n'avez pas fait ce changement, contactez le support.`,
  );
}
