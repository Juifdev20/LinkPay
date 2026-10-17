import { ForbiddenException } from '@nestjs/common';

const MERCHANT_BLOCKED = ['suspended', 'rejected', 'closed'];
const ORGANIZATION_BLOCKED = ['suspended', 'closed'];

/**
 * A merchant (or the business it belongs to) that an administrator suspended, rejected or closed can no longer
 * receive payments: no new invoice, no payment on an existing one. Until now the status was only ever written by the
 * admin screen and never read, so "suspend" changed nothing.
 */
export async function assertMerchantCanReceive(client: any, merchantId: string | null | undefined): Promise<void> {
  if (!merchantId) return;
  const { data: merchant } = await client.from('merchants').select('status, organization_id').eq('id', merchantId).maybeSingle();
  if (!merchant) return; // unknown: the callers' own checks deal with it

  const blocked = MERCHANT_BLOCKED.includes(merchant.status);
  let orgBlocked = false;
  if (!blocked && merchant.organization_id) {
    const { data: org } = await client.from('organizations').select('status').eq('id', merchant.organization_id).maybeSingle();
    orgBlocked = !!org && ORGANIZATION_BLOCKED.includes(org.status);
  }
  if (blocked || orgBlocked) {
    throw new ForbiddenException({
      statusCode: 403,
      code: 'MERCHANT_SUSPENDED',
      message: "Ce commerce est suspendu : il ne peut plus recevoir de paiements. Contactez le support si vous pensez qu'il s'agit d'une erreur.",
    });
  }
}
