import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MerchantInvitationsService } from './merchant-invitations.service';

/** The invited person's side: see the shops inviting them, accept or refuse (any signed-in account). */
@ApiTags('Merchant invitations')
@ApiBearerAuth()
@Controller('merchant-invitations')
export class MerchantInvitationsController {
  constructor(private invitations: MerchantInvitationsService) {}

  @Get('mine')
  @ApiOperation({ summary: 'Cashier invitations waiting for my answer' })
  async mine(@CurrentUser('id') userId: string) {
    return this.invitations.listForUser(userId);
  }

  @Post(':id/accept')
  @ApiOperation({ summary: 'Accept: I join the shop as cashier (returns a new access token)' })
  async accept(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('email') email: string,
    @CurrentUser('session_id') sessionId?: string,
  ) {
    return this.invitations.accept(userId, email, sessionId, id);
  }

  @Post(':id/decline')
  @ApiOperation({ summary: 'Refuse the invitation' })
  async decline(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.invitations.decline(userId, id);
  }
}
