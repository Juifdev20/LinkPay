import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { SupabaseService } from '../supabase/supabase.service';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const PIN_REGEX = /^\d{4,6}$/;

/**
 * Transaction PIN — required for transfer/withdrawal/wallet-payment, per the
 * master prompt's security requirements. Never stored in clear (bcrypt hash
 * only), never logged (not even in error messages — only outcome/attempt
 * count), locked out after MAX_ATTEMPTS wrong tries for LOCKOUT_MINUTES.
 */
@Injectable()
export class WalletPinService {
  constructor(private supabaseService: SupabaseService) {}

  async hasPinSet(userId: string): Promise<boolean> {
    const { data } = await this.supabaseService.getClient()
      .from('profiles')
      .select('transaction_pin_hash')
      .eq('id', userId)
      .single();
    return !!data?.transaction_pin_hash;
  }

  /** Sets or changes the PIN. If one already exists, currentPin must verify first. */
  async setPin(userId: string, newPin: string, currentPin?: string): Promise<void> {
    if (!PIN_REGEX.test(newPin)) {
      throw new BadRequestException('Le code PIN doit comporter entre 4 et 6 chiffres.');
    }

    const alreadySet = await this.hasPinSet(userId);
    if (alreadySet) {
      if (!currentPin) {
        throw new BadRequestException('Le code PIN actuel est requis pour le modifier.');
      }
      await this.verifyPin(userId, currentPin);
    }

    const hash = await bcrypt.hash(newPin, 10);
    const { error } = await this.supabaseService.getClient()
      .from('profiles')
      .update({ transaction_pin_hash: hash, pin_attempts: 0, pin_locked_until: null })
      .eq('id', userId);

    if (error) {
      throw new Error(`Failed to set transaction PIN: ${error.message}`);
    }
  }

  /**
   * Verifies a PIN for a sensitive operation. Throws ForbiddenException if
   * locked out, BadRequestException on a wrong PIN (never reveals whether
   * a PIN even exists beyond the generic "not configured" message).
   */
  async verifyPin(userId: string, pin: string): Promise<void> {
    const client = this.supabaseService.getClient();

    // The try is counted BEFORE the PIN is compared, under a row lock (migration 055): fifty parallel guesses
    // can no longer all pass the "is it locked?" check. If that function isn't there yet, the older read-then-write
    // path below keeps working.
    const { data: reserved, error: reserveError } = await client.rpc('reserve_pin_attempt', {
      p_user: userId,
      p_max: MAX_ATTEMPTS,
      p_lock_seconds: LOCKOUT_MINUTES * 60,
    });
    if (reserveError) return this.verifyPinLegacy(userId, pin);

    const r = Array.isArray(reserved) ? reserved[0] : reserved;
    if (!r?.has_pin) {
      throw new BadRequestException('Aucun code PIN configuré. Veuillez le définir dans les paramètres.');
    }
    if (!r.allowed) {
      const minutesLeft = Math.max(1, Math.ceil((new Date(r.locked_until).getTime() - Date.now()) / 60000));
      throw new ForbiddenException(`Trop de tentatives échouées. Réessayez dans ${minutesLeft} min.`);
    }

    const { data: profile } = await client.from('profiles').select('transaction_pin_hash').eq('id', userId).single();
    const valid = !!profile?.transaction_pin_hash && (await bcrypt.compare(pin, profile.transaction_pin_hash));
    if (valid) {
      await client.rpc('clear_pin_attempts', { p_user: userId });
      return;
    }
    if (r.just_locked) throw new ForbiddenException(`Trop de tentatives échouées. Compte verrouillé ${LOCKOUT_MINUTES} min.`);
    throw new BadRequestException(`Code PIN incorrect (${MAX_ATTEMPTS - r.attempts} tentative(s) restante(s)).`);
  }

  private async verifyPinLegacy(userId: string, pin: string): Promise<void> {
    const { data: profile } = await this.supabaseService.getClient()
      .from('profiles')
      .select('transaction_pin_hash, pin_attempts, pin_locked_until')
      .eq('id', userId)
      .single();

    if (!profile?.transaction_pin_hash) {
      throw new BadRequestException('Aucun code PIN configuré. Veuillez le définir dans les paramètres.');
    }

    if (profile.pin_locked_until && new Date(profile.pin_locked_until) > new Date()) {
      const minutesLeft = Math.ceil((new Date(profile.pin_locked_until).getTime() - Date.now()) / 60000);
      throw new ForbiddenException(`Trop de tentatives échouées. Réessayez dans ${minutesLeft} min.`);
    }

    const valid = await bcrypt.compare(pin, profile.transaction_pin_hash);

    if (!valid) {
      const attempts = (profile.pin_attempts || 0) + 1;
      const locked = attempts >= MAX_ATTEMPTS;
      await this.supabaseService.getClient()
        .from('profiles')
        .update({
          pin_attempts: locked ? 0 : attempts,
          pin_locked_until: locked ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString() : null,
        })
        .eq('id', userId);

      if (locked) {
        throw new ForbiddenException(`Trop de tentatives échouées. Compte verrouillé ${LOCKOUT_MINUTES} min.`);
      }
      throw new BadRequestException(`Code PIN incorrect (${MAX_ATTEMPTS - attempts} tentative(s) restante(s)).`);
    }

    // Correct PIN — reset the failure counter.
    if (profile.pin_attempts) {
      await this.supabaseService.getClient()
        .from('profiles')
        .update({ pin_attempts: 0, pin_locked_until: null })
        .eq('id', userId);
    }
  }
}
