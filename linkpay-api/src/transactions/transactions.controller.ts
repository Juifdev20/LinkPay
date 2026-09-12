import { Controller, Get, Param, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Transactions')
@ApiBearerAuth()
@Controller('transactions')
export class TransactionsController {
  constructor(private transactionsService: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: 'List transactions (client sees own, merchant sees store, admin sees all)' })
  async list(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('merchant_id') merchantId: string | undefined,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const filters = {
      status,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
      search,
    };

    if (role === 'admin' || role === 'super_admin') {
      return this.transactionsService.getAllTransactions(filters);
    }
    if (merchantId && (role === 'merchant' || role === 'cashier' || role === 'enterprise')) {
      return this.transactionsService.getMerchantTransactions(merchantId, filters);
    }
    return this.transactionsService.getClientTransactions(userId, filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get transaction by ID (own transaction, own store, or admin only)' })
  async getById(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('merchant_id') merchantId: string | undefined,
  ) {
    return this.transactionsService.getTransactionById(id, { userId, role, merchantId });
  }

  @Get('reference/:reference')
  @ApiOperation({ summary: 'Get transaction by reference (own transaction, own store, or admin only)' })
  async getByReference(
    @Param('reference') reference: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('merchant_id') merchantId: string | undefined,
  ) {
    return this.transactionsService.getTransactionByReference(reference, { userId, role, merchantId });
  }

  @Get(':id/receipt')
  @ApiOperation({ summary: 'Get transaction receipt (own transaction, own store, or admin only)' })
  async getReceipt(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('merchant_id') merchantId: string | undefined,
  ) {
    return this.transactionsService.getReceipt(id, { userId, role, merchantId });
  }
}
