import { Injectable, HttpException, HttpStatus, Logger, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';

export const MAX_FAILED_LOGINS = 5;
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_LOCK_MS = 15 * 60_000;

interface Attempts {
  failures: number[];
  lockedUntil: number;
}

/**
 * Per-account brute-force brake for login and 2FA codes.
 *
 * The IP throttle alone doesn't stop a guesser who rotates IPs (a botnet, a
 * VPN pool): each IP stays under its budget while the SAME account is hit
 * thousands of times. This counts failures per account, whatever the IP: after
 * MAX_FAILED_LOGINS wrong attempts in LOGIN_WINDOW_MS the account refuses
 * logins for LOGIN_LOCK_MS — even with the right password, so a guesser can't
 * keep going and learn when they've hit it. The lock expires by itself.
 *
 * The counters live in the database (migration 049, keyed by a hash of the
 * account) so every API instance and every restart sees the same state. If the
 * database part is unavailable — migration not applied yet, an outage — it
 * falls back to counters in this process's memory: weaker with several
 * instances, but never "no protection" and never a login outage.
 */
@Injectable()
export class LoginAttemptsService {
  private readonly logger = new Logger(LoginAttemptsService.name);
  private readonly byKey = new Map<string, Attempts>();
  private warnedFallback = false;

  constructor(@Optional() private supabaseService?: SupabaseService) {}

  private key(account: string) {
    return account.trim().toLowerCase();
  }

  private hashed(account: string) {
    return createHash('sha256').update(this.key(account)).digest('hex');
  }

  private fellBack(reason: string) {
    if (!this.warnedFallback) {
      this.warnedFallback = true;
      this.logger.warn(`Login attempt counters fall back to memory (${reason}). Apply migration 049 to share them across instances.`);
    }
  }

  /** Throws 429 when the account is currently locked. */
  async assertNotLocked(account: string, now = Date.now()): Promise<void> {
    let until: number | null = null;
    if (this.supabaseService) {
      try {
        const { data, error } = await this.supabaseService.getClient().rpc('get_auth_lock', { p_key: this.hashed(account) });
        if (error) this.fellBack(error.message);
        else until = data ? new Date(data).getTime() : null;
      } catch (err: any) {
        this.fellBack(err?.message);
      }
    }
    const memory = this.byKey.get(this.key(account));
    if (memory && memory.lockedUntil > now) until = Math.max(until ?? 0, memory.lockedUntil);

    if (until && until > now) {
      const minutes = Math.ceil((until - now) / 60_000);
      throw new HttpException(
        `Trop de tentatives de connexion. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Returns true when this failure is the one that locks the account. */
  async recordFailure(account: string, now = Date.now()): Promise<boolean> {
    if (this.supabaseService) {
      try {
        const { data, error } = await this.supabaseService.getClient().rpc('record_auth_failure', {
          p_key: this.hashed(account),
          p_max: MAX_FAILED_LOGINS,
          p_window_seconds: LOGIN_WINDOW_MS / 1000,
          p_lock_seconds: LOGIN_LOCK_MS / 1000,
        });
        if (!error) {
          const row = Array.isArray(data) ? data[0] : data;
          return !!row?.just_locked;
        }
        this.fellBack(error.message);
      } catch (err: any) {
        this.fellBack(err?.message);
      }
    }
    return this.recordFailureInMemory(account, now);
  }

  async recordSuccess(account: string): Promise<void> {
    this.byKey.delete(this.key(account));
    if (!this.supabaseService) return;
    try {
      await this.supabaseService.getClient().rpc('clear_auth_attempts', { p_key: this.hashed(account) });
    } catch {
      /* the memory side is already cleared; the database row ages out on its own */
    }
  }

  private recordFailureInMemory(account: string, now: number): boolean {
    const k = this.key(account);
    const entry = this.byKey.get(k) ?? { failures: [], lockedUntil: 0 };
    entry.failures = entry.failures.filter((t) => now - t < LOGIN_WINDOW_MS);
    entry.failures.push(now);
    let locked = false;
    if (entry.failures.length >= MAX_FAILED_LOGINS) {
      entry.lockedUntil = now + LOGIN_LOCK_MS;
      entry.failures = [];
      locked = true;
    }
    this.byKey.set(k, entry);
    if (this.byKey.size > 10_000) this.prune(now);
    return locked;
  }

  private prune(now: number) {
    for (const [k, v] of this.byKey) {
      if (v.lockedUntil <= now && v.failures.every((t) => now - t >= LOGIN_WINDOW_MS)) this.byKey.delete(k);
    }
  }
}
