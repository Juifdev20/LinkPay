import { Injectable, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { SupabaseService } from '../supabase/supabase.service';
import { canonicalRecoveryCode, generateRecoveryCode, phoneLikePattern, samePhone } from './phone';

/**
 * Accounts found by their phone number, and their recovery code — the way to
 * get back in without SMS when the password is forgotten.
 */
@Injectable()
export class PhoneAccountService {
  constructor(private supabaseService: SupabaseService) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  /** Ids of the accounts using this number (normalized "+243…"), whatever format their profile stored it in. */
  async userIdsByPhone(normalized: string): Promise<string[]> {
    const { data } = await this.db.from('profiles').select('id, phone').like('phone', phoneLikePattern(normalized)).limit(10);
    return (data || []).filter((p) => samePhone(p.phone, normalized)).map((p) => p.id);
  }

  /**
   * The one account behind a number, or null. Two accounts on the same number
   * (older sign-ups weren't checked) can't be told apart: they log in by email.
   */
  async userIdByPhone(normalized: string): Promise<string | null> {
    const ids = await this.userIdsByPhone(normalized);
    if (ids.length > 1) {
      throw new BadRequestException('Plusieurs comptes utilisent ce numéro : connectez-vous avec votre adresse email.');
    }
    return ids[0] || null;
  }

  /** The email Supabase Auth signs this account in with — the real one, or the technical one of a phone-only account. */
  async authEmailOf(userId: string): Promise<string | null> {
    const { data } = await this.db.auth.admin.getUserById(userId);
    return data?.user?.email || null;
  }

  /** Creates (or replaces) the account's recovery code; returns it — the only time it is ever readable. */
  async issueRecoveryCode(userId: string): Promise<string> {
    const code = generateRecoveryCode();
    const hash = await bcrypt.hash(canonicalRecoveryCode(code), 10);
    const { error } = await this.db
      .from('profiles')
      .update({ recovery_code_hash: hash, recovery_code_set_at: new Date().toISOString() })
      .eq('id', userId);
    if (error) throw new Error(`Failed to store the recovery code: ${error.message}`);
    return code;
  }

  async hasRecoveryCode(userId: string): Promise<boolean> {
    const { data } = await this.db.from('profiles').select('recovery_code_hash').eq('id', userId).maybeSingle();
    return !!data?.recovery_code_hash;
  }

  async recoveryCodeMatches(userId: string, code: string): Promise<boolean> {
    const { data } = await this.db.from('profiles').select('recovery_code_hash').eq('id', userId).maybeSingle();
    if (!data?.recovery_code_hash) return false;
    return bcrypt.compare(canonicalRecoveryCode(code), data.recovery_code_hash);
  }
}
