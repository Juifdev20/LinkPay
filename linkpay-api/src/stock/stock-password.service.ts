import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { SupabaseService } from '../supabase/supabase.service';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

/**
 * Stock management password — gates editing/deleting a stock item (viewing
 * stays open). One shared secret per organization (not per-user), same
 * bcrypt-hash + attempt-counter + lockout shape as WalletPinService, just
 * scoped to `organizations` instead of `profiles`. Set the first time
 * anyone tries to edit/delete an item; the owner can always reset it
 * without knowing the current one (resetPassword), since the point is
 * protecting against accidental changes by stock staff, not locking out
 * the owner.
 */
@Injectable()
export class StockPasswordService {
  constructor(private supabaseService: SupabaseService) {}

  async hasPasswordSet(orgId: string): Promise<boolean> {
    const { data } = await this.supabaseService.getClient()
      .from('organizations')
      .select('stock_password_hash')
      .eq('id', orgId)
      .single();
    return !!data?.stock_password_hash;
  }

  /** Sets or changes the password. If one already exists, currentPassword must verify first. */
  async setPassword(orgId: string, newPassword: string, currentPassword?: string): Promise<void> {
    if (!newPassword || newPassword.length < 4) {
      throw new BadRequestException('Le mot de passe doit comporter au moins 4 caractères.');
    }

    const alreadySet = await this.hasPasswordSet(orgId);
    if (alreadySet) {
      if (!currentPassword) {
        throw new BadRequestException('Le mot de passe actuel est requis pour le modifier.');
      }
      await this.verifyPassword(orgId, currentPassword);
    }

    const hash = await bcrypt.hash(newPassword, 10);
    const { error } = await this.supabaseService.getClient()
      .from('organizations')
      .update({ stock_password_hash: hash, stock_password_attempts: 0, stock_password_locked_until: null })
      .eq('id', orgId);

    if (error) {
      throw new Error(`Failed to set stock password: ${error.message}`);
    }
  }

  /** Owner-only override — overwrites the password without knowing the current one. */
  async resetPassword(orgId: string, newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < 4) {
      throw new BadRequestException('Le mot de passe doit comporter au moins 4 caractères.');
    }

    const hash = await bcrypt.hash(newPassword, 10);
    const { error } = await this.supabaseService.getClient()
      .from('organizations')
      .update({ stock_password_hash: hash, stock_password_attempts: 0, stock_password_locked_until: null })
      .eq('id', orgId);

    if (error) {
      throw new Error(`Failed to reset stock password: ${error.message}`);
    }
  }

  /**
   * Verifies the password for an edit/delete. Throws ForbiddenException if
   * locked out, BadRequestException on a wrong password.
   */
  async verifyPassword(orgId: string, password: string): Promise<void> {
    const { data: org } = await this.supabaseService.getClient()
      .from('organizations')
      .select('stock_password_hash, stock_password_attempts, stock_password_locked_until')
      .eq('id', orgId)
      .single();

    if (!org?.stock_password_hash) {
      throw new BadRequestException('Aucun mot de passe de gestion de stock configuré.');
    }

    if (org.stock_password_locked_until && new Date(org.stock_password_locked_until) > new Date()) {
      const minutesLeft = Math.ceil((new Date(org.stock_password_locked_until).getTime() - Date.now()) / 60000);
      throw new ForbiddenException(`Trop de tentatives échouées. Réessayez dans ${minutesLeft} min.`);
    }

    const valid = await bcrypt.compare(password, org.stock_password_hash);

    if (!valid) {
      const attempts = (org.stock_password_attempts || 0) + 1;
      const locked = attempts >= MAX_ATTEMPTS;
      await this.supabaseService.getClient()
        .from('organizations')
        .update({
          stock_password_attempts: locked ? 0 : attempts,
          stock_password_locked_until: locked ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString() : null,
        })
        .eq('id', orgId);

      if (locked) {
        throw new ForbiddenException(`Trop de tentatives échouées. Module verrouillé ${LOCKOUT_MINUTES} min.`);
      }
      throw new BadRequestException(`Mot de passe incorrect (${MAX_ATTEMPTS - attempts} tentative(s) restante(s)).`);
    }

    if (org.stock_password_attempts) {
      await this.supabaseService.getClient()
        .from('organizations')
        .update({ stock_password_attempts: 0, stock_password_locked_until: null })
        .eq('id', orgId);
    }
  }
}
