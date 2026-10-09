/**
 * Credits a wallet top-up exactly once, whoever confirms it (PSP webhook, delivered once or twice; the status
 * check the app makes when the user returns from the payment page; the mock provider).
 *
 * Preferred path: the complete_topup() SQL function (migration 056) — claim, credit and status change in ONE
 * transaction. If the function is not there yet (migration not applied), the same guarantee is rebuilt from
 * two steps: atomically claim PENDING → SUCCESS, credit, and if the credit fails put the status back to PENDING
 * so the next confirmation can retry — never "claimed but not credited", never "credited twice".
 */
export interface TopupCompletion {
  credited: boolean;
  userId?: string;
  amountCents?: number;
  currency?: string;
}

const FUNCTION_MISSING = /could not find the function|does not exist|schema cache/i;

export async function completeTopupOnce(
  client: any,
  topupId: string,
  pspIntentId: string | undefined,
  log: { warn: (m: string) => void },
): Promise<TopupCompletion> {
  const { data, error } = await client.rpc('complete_topup', { p_topup_id: topupId, p_psp_intent_id: pspIntentId ?? null });
  if (!error) {
    const row = Array.isArray(data) ? data[0] : data;
    return { credited: !!row?.credited, userId: row?.user_id, amountCents: row?.amount_cents != null ? Number(row.amount_cents) : undefined, currency: row?.currency };
  }
  if (/TOPUP_NOT_FOUND/.test(error.message)) throw new Error('Wallet top-up not found');
  if (!FUNCTION_MISSING.test(error.message)) throw new Error(`Failed to complete top-up ${topupId}: ${error.message}`);

  log.warn('complete_topup() is not available (apply migration 056) — using the two-step fallback');
  const { data: topup } = await client.from('wallet_topups').select('*').eq('id', topupId).single();
  if (!topup) throw new Error('Wallet top-up not found');
  const { data: claimed } = await client
    .from('wallet_topups')
    .update({ status: 'SUCCESS', updated_at: new Date().toISOString() })
    .eq('id', topupId)
    .in('status', ['PENDING', 'FAILED'])
    .select()
    .maybeSingle();
  if (!claimed) return { credited: false };

  const { error: creditError } = await client.rpc('credit_wallet', {
    p_wallet_id: topup.wallet_id,
    p_amount_cents: topup.amount_cents,
    p_entry_type: 'TOPUP',
    p_reference: `TOPUP-${topup.id}`,
    p_currency: topup.currency,
    p_metadata: { wallet_topup_id: topup.id, psp_intent_id: pspIntentId },
  });
  if (creditError) {
    // Give the claim back: the payment is real and must be creditable by the next confirmation.
    await client.from('wallet_topups').update({ status: 'PENDING', updated_at: new Date().toISOString() }).eq('id', topupId);
    throw new Error(`Failed to credit wallet for top-up ${topupId}: ${creditError.message}`);
  }
  const { data: wallet } = await client.from('wallets').select('user_id').eq('id', topup.wallet_id).single();
  return { credited: true, userId: wallet?.user_id, amountCents: Number(topup.amount_cents), currency: topup.currency };
}
