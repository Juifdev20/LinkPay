import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RefundsService } from './refunds.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { IsNumber, IsString, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class CreateRefundDto {
  @ApiProperty({ example: 50000, description: 'Refund amount in cents' })
  @IsNumber()
  @Min(1)
  @Max(99999999999)
  amount_cents!: number;

  @ApiPropertyOptional({ example: 'Customer complaint' })
  @IsOptional()
  @IsString()
  reason?: string;
}

@ApiTags('Refunds')
@ApiBearerAuth()
@Controller('refunds')
export class RefundsController {
  constructor(private refundsService: RefundsService) {}

  @Post('transaction/:transactionId')
  @Roles('merchant', 'admin', 'super_admin')
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Create a refund for a transaction' })
  async createRefund(
    @Param('transactionId') transactionId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateRefundDto,
  ) {
    return this.refundsService.createRefund(transactionId, dto, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get refund by ID' })
  async getRefund(@Param('id') id: string) {
    return this.refundsService.getRefundById(id);
  }

  @Get('transaction/:transactionId')
  @ApiOperation({ summary: 'List refunds for a transaction' })
  async getTransactionRefunds(@Param('transactionId') transactionId: string) {
    return this.refundsService.getTransactionRefunds(transactionId);
  }
}
