import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { WithdrawalPayoutService } from './withdrawal-payout.service';

/**
 * Where a payment provider posts the outcome of a withdrawal it was asked to send. Public, like the payment
 * webhooks: nothing in the body is believed — it only makes us ask the provider about that withdrawal now instead
 * of at the next reconciliation.
 */
@ApiTags('Webhooks')
@Controller('webhooks/payouts')
export class WithdrawalCallbacksController {
  constructor(private payouts: WithdrawalPayoutService) {}

  @Public()
  @Post(':provider')
  @HttpCode(200)
  @ApiOperation({ summary: 'Payout callback from the payment provider (public, re-checked with the provider)' })
  async handle(@Param('provider') provider: string, @Req() req: Request) {
    return this.payouts.handleCallback(provider, (req as any).rawBody as Buffer);
  }
}
