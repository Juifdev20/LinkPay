import { ForbiddenException, Logger, ServiceUnavailableException } from '@nestjs/common';

/**
 * Test money (docs/RECHARGE_TEST.md): written by the developers straight into the database, on wallets marked
 * wallets.is_test (migration 069). The app itself never creates money. Test money must never become real money, so
 * it may only move between test wallets: it never leaves ScanLinkPay (withdrawal) and never reaches a real wallet
 * (transfer, wallet payment to a merchant, merchant refund).
 */
const logger = new Logger('TestMoney');

type Side = { walletId?: string | null; userId?: string | null };

async function isTestWallet(client: any, side: Side): Promise<boolean> {
  if (!side.walletId && !side.userId) return false;
  let q = client.from('wallets').select('id, is_test');
  q = side.walletId ? q.eq('id', side.walletId) : q.eq('user_id', side.userId);
  const { data, error } = await q.maybeSingle();
  if (error) {
    // Migration 069 not applied: no wallet can have been marked as a test wallet yet.
    if (/is_test/i.test(String(error.message))) {
      logger.warn('wallets.is_test is missing (apply migration 069)');
      return false;
    }
    throw new ServiceUnavailableException("L'opération est momentanément indisponible. Réessayez dans quelques minutes.");
  }
  return data?.is_test === true;
}

/** `to` = null: the money leaves ScanLinkPay (a withdrawal). */
export async function assertTestMoneyStaysInTests(client: any, from: Side, to: Side | null): Promise<void> {
  if (!(await isTestWallet(client, from))) return;
  if (to === null) {
    throw new ForbiddenException("Ce portefeuille contient de l'argent de test : il ne peut pas sortir de ScanLinkPay.");
  }
  if (!(await isTestWallet(client, to))) {
    throw new ForbiddenException("L'argent de test ne peut aller que vers un autre portefeuille de test.");
  }
}
