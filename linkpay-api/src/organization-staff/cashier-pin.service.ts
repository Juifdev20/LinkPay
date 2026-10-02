import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { SupabaseService } from '../supabase/supabase.service';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const PIN_REGEX = /^\d{4,6}$/;

/**
 * Cash-register unlock PIN for organization staff (cashiers) — deliberately
 * NOT the same thing as WalletPinService's transaction PIN (that one
 * authorizes spending from the PIN owner's own wallet, keyed on
 * `profiles`). This one answers "which employee is operating this shared
 * physical till right now," keyed on `organization_staff` instead, so a
 * cashier's till PIN and their own personal ScanLinkPay PIN stay unrelated.
 * Same bcrypt + lockout pattern as WalletPinService, copied verbatim.
 */
@Injectable()
export class CashierPinService {
  constructor(private supabaseService: SupabaseService) {}

  private async getStaffRow(userId: string) {
    const { data } = await this.supabaseService.getClient()
      .from('organization_staff')
      .select('id, pos_pin_hash, pos_pin_attempts, pos_pin_locked_until')
      .eq('user_id', userId)
      .single();
    return data;
  }

  async hasPinSet(userId: string): Promise<boolean> {
    const staff = await this.getStaffRow(userId);
    return !!staff?.pos_pin_hash;
  }

  async setPin(userId: string, newPin: string, currentPin?: string): Promise<void> {
    if (!PIN_REGEX.test(newPin)) {
      throw new BadRequestException('Le code PIN doit comporter entre 4 et 6 chiffres.');
    }

    const staff = await this.getStaffRow(userId);
    if (!staff) {
      throw new NotFoundException("Aucun compte employé associé à cet utilisateur");
    }

    if (staff.pos_pin_hash) {
      if (!currentPin) {
        throw new BadRequestException('Le code PIN actuel est requis pour le modifier.');
      }
      await this.verifyPin(userId, currentPin);
    }

    const hash = await bcrypt.hash(newPin, 10);
    const { error } = await this.supabaseService.getClient()
      .from('organization_staff')
      .update({ pos_pin_hash: hash, pos_pin_attempts: 0, pos_pin_locked_until: null })
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to set cashier PIN: ${error.message}`);
    }
  }

  async verifyPin(userId: string, pin: string): Promise<void> {
    const staff = await this.getStaffRow(userId);

    if (!staff?.pos_pin_hash) {
      throw new BadRequestException('Aucun code PIN de caisse configuré. Veuillez le définir dans vos paramètres.');
    }

    if (staff.pos_pin_locked_until && new Date(staff.pos_pin_locked_until) > new Date()) {
      const minutesLeft = Math.ceil((new Date(staff.pos_pin_locked_until).getTime() - Date.now()) / 60000);
      throw new ForbiddenException(`Trop de tentatives échouées. Réessayez dans ${minutesLeft} min.`);
    }

    const valid = await bcrypt.compare(pin, staff.pos_pin_hash);

    if (!valid) {
      const attempts = (staff.pos_pin_attempts || 0) + 1;
      const locked = attempts >= MAX_ATTEMPTS;
      await this.supabaseService.getClient()
        .from('organization_staff')
        .update({
          pos_pin_attempts: locked ? 0 : attempts,
          pos_pin_locked_until: locked ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString() : null,
        })
        .eq('user_id', userId);

      if (locked) {
        throw new ForbiddenException(`Trop de tentatives échouées. Caisse verrouillée ${LOCKOUT_MINUTES} min.`);
      }
      throw new BadRequestException(`Code PIN incorrect (${MAX_ATTEMPTS - attempts} tentative(s) restante(s)).`);
    }

    if (staff.pos_pin_attempts) {
      await this.supabaseService.getClient()
        .from('organization_staff')
        .update({ pos_pin_attempts: 0, pos_pin_locked_until: null })
        .eq('user_id', userId);
    }
  }
}
