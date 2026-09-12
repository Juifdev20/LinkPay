import { Controller, Post, Req, Param, Get, Query, Headers, BadRequestException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Request } from 'express';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private webhooksService: WebhooksService) {}

  @Public()
  @Post(':provider')
  @ApiOperation({ summary: 'PSP webhook receiver (public, signature verified)' })
  async handleWebhook(
    @Param('provider') provider: string,
    @Req() req: Request,
    @Headers() headers: Record<string, string>,
  ) {
    const rawBody = (req as any).rawBody as Buffer;
    const signature = headers['x-signature'] || headers['verif-hash'] || '';
    return this.webhooksService.handleWebhook(provider, rawBody, signature, headers);
  }

  @Get('events')
  @Roles('admin', 'super_admin')
  @UseGuards(RolesGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List webhook events (admin only)' })
  async listEvents(
    @Query('provider') provider?: string,
    @Query('processed') processed?: string,
  ) {
    return this.webhooksService.getWebhookEvents({
      provider,
      processed: processed !== undefined ? processed === 'true' : undefined,
    });
  }
}
