import { Injectable, HttpException, HttpStatus } from '@nestjs/common';

export const MAX_FAILED_LOGINS = 5;
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_LOCK_MS = 15 * 60_000;

interface Attempts {
  failures: number[];
  lockedUntil: number;
}

/**
 * Per-account brute-force brake for the login endpoint.
 *
 * The IP throttle alone doesn't stop a guesser who rotates IPs (a botnet, a
 * VPN pool): each IP stays under its budget while the SAME account is hit
 * thousands of times. This counts failures per email, whatever the IP: after
 * MAX_FAILED_LOGINS wrong passwords in LOGIN_WINDOW_MS the account refuses
 * logins for LOGIN_LOCK_MS — even with the right password, so a guesser can't
 * keep going and learn when they've hit it. The lock expires by itself.
 *
 * State is in memory (one API instance, as deployed on Render): a restart
 * clears it, which only ever gives an attacker a fresh budget, never locks a
 * legitimate user out for good. Moving to Redis is needed before scaling to
 * several instances.
 */
@Injectable()
export class LoginAttemptsService {
  private readonly byKey = new Map<string, Attempts>();

  private key(email: string) {
    return email.trim().toLowerCase();
  }

  /** Throws 429 when the account is currently locked. */
  assertNotLocked(email: string, now = Date.now()): void {
    const entry = this.byKey.get(this.key(email));
    if (entry && entry.lockedUntil > now) {
      const minutes = Math.ceil((entry.lockedUntil - now) / 60_000);
      throw new HttpException(
        `Trop de tentatives de connexion. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  recordFailure(email: string, now = Date.now()): void {
    const k = this.key(email);
    const entry = this.byKey.get(k) ?? { failures: [], lockedUntil: 0 };
    entry.failures = entry.failures.filter((t) => now - t < LOGIN_WINDOW_MS);
    entry.failures.push(now);
    if (entry.failures.length >= MAX_FAILED_LOGINS) {
      entry.lockedUntil = now + LOGIN_LOCK_MS;
      entry.failures = [];
    }
    this.byKey.set(k, entry);
    if (this.byKey.size > 10_000) this.prune(now);
  }

  recordSuccess(email: string): void {
    this.byKey.delete(this.key(email));
  }

  private prune(now: number) {
    for (const [k, v] of this.byKey) {
      if (v.lockedUntil <= now && v.failures.every((t) => now - t >= LOGIN_WINDOW_MS)) this.byKey.delete(k);
    }
  }
}
