/**
 * Settles a PSP-funded person-to-person transfer exactly once, whoever confirms
 * it (PSP webhook, delivered once or twice; the status check the app makes while
 * the sender waits; the reconciliation sweep).
 *
 * Preferred path: the complete_funded_transfer() SQL function (migration 062) —
 * claim and recipient credit in ONE transaction. If the function is not there
 * yet (migration not applied), the same guarantee is rebuilt from two steps:
 * atomically claim PENDING → SUCCESS, credit the recipient, and if the credit
 * fails put the status back to PENDING so the next confirmation retries —
 * never "claimed but not credited", never "credited twice".
 */
export interface FundedTransferCompletion {
  credited: boolean;
  senderUserId?: string;
  recipientUserId?: string;
  amountCents?: number;
  currency?: string;
}

const FUNCTION_MISSING = /could not find the function|does not exist|schema cache/i;

export async function completeFundedTransferOnce(
  client: any,
  transferId: string,
  pspIntentId: string | undefined,
  log: { warn: (m: string) => void },
): Promise<FundedTransferCompletion> {
  const { data, error } = await client.rpc('complete_funded_transfer', { p_transfer_id: transferId, p_psp_intent_id: pspIntentId ?? null });
  if (!error) {
    const row = Array.isArray(data) ? data[0] : data;
    return {
      credited: !!row?.credited,
      senderUserId: row?.sender_user_id,
      recipientUserId: row?.recipient_user_id,
      amountCents: row?.amount_cents != null ? Number(row.amount_cents) : undefined,
      currency: row?.currency,
    };
  }
  if (/FUNDED_TRANSFER_NOT_FOUND/.test(error.message)) throw new Error('Transfer not found');
  if (!FUNCTION_MISSING.test(error.message)) throw new Error(`Failed to complete funded transfer ${transferId}: ${error.message}`);

  log.warn('complete_funded_transfer() is not available (apply migration 062) — using the two-step fallback');
  const { data: transfer } = await client.from('transfers').select('*').eq('id', transferId).single();
  if (!transfer) throw new Error('Transfer not found');
  const { data: claimed } = await client
    .from('transfers')
    .update({ status: 'SUCCESS', updated_at: new Date().toISOString() })
    .eq('id', transferId)
    .eq('status', 'PENDING')
    .select()
    .maybeSingle();
  if (!claimed) return { credited: false };

  const { error: creditError } = await client.rpc('credit_wallet', {
    p_wallet_id: transfer.recipient_wallet_id,
    p_amount_cents: transfer.amount_cents,
    p_entry_type: 'TRANSFER_IN',
    p_reference: `TRANSFER-${transfer.id}`,
    p_currency: transfer.currency,
    p_metadata: { transfer_id: transfer.id, counterparty_wallet_id: transfer.sender_wallet_id, funded_by: transfer.psp_provider ?? 'psp' },
  });
  if (creditError) {
    // Give the claim back: the payment is real and must be creditable by the next confirmation.
    await client.from('transfers').update({ status: 'PENDING', updated_at: new Date().toISOString() }).eq('id', transferId);
    throw new Error(`Failed to credit recipient for funded transfer ${transferId}: ${creditError.message}`);
  }
  const [{ data: sender }, { data: recipient }] = await Promise.all([
    client.from('wallets').select('user_id').eq('id', transfer.sender_wallet_id).single(),
    client.from('wallets').select('user_id').eq('id', transfer.recipient_wallet_id).single(),
  ]);
  return {
    credited: true,
    senderUserId: sender?.user_id,
    recipientUserId: recipient?.user_id,
    amountCents: Number(transfer.amount_cents),
    currency: transfer.currency,
  };
}
