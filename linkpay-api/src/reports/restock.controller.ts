import { Controller, Get, Post, Put, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested, ArrayMaxSize } from 'class-validator';
import { RestockService } from './restock.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

class RestockLineDto {
  @ApiProperty() @IsUUID() stock_item_id!: string;
  @ApiProperty() @IsInt() @Min(1) wanted_qty!: number;
}

class CreateRestockDto {
  @ApiProperty({ type: [RestockLineDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RestockLineDto)
  items!: RestockLineDto[];

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class UpdateRestockDto {
  @ApiProperty({ enum: ['approved', 'rejected', 'received'] }) @IsIn(['approved', 'rejected', 'received']) status!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

@ApiTags('Restock requests')
@ApiBearerAuth()
@Controller()
@Roles('enterprise', 'gerant', 'magasinier')
@UseGuards(RolesGuard)
export class RestockController {
  constructor(private restock: RestockService) {}

  @Post('merchants/:id/restock-requests')
  @ApiOperation({ summary: 'Ask the owner to restock articles of this station (manager, stock keeper, owner)' })
  create(@Param('id') merchantId: string, @Body() dto: CreateRestockDto, @CurrentUser() caller: any) {
    return this.restock.create(merchantId, caller, dto);
  }

  @Get('organizations/:id/restock-requests')
  @ApiOperation({ summary: "Restock requests — every station's for the owner, their station's for a manager / stock keeper" })
  list(
    @Param('id') orgId: string,
    @Query('status') status: string | undefined,
    @Query('merchant_id') merchantId: string | undefined,
    @CurrentUser() caller: any,
  ) {
    return this.restock.list(orgId, caller, { status, merchant_id: merchantId });
  }

  @Put('organizations/:id/restock-requests/:requestId')
  @ApiOperation({ summary: 'Approve / refuse (owner) or mark received (station)' })
  update(@Param('id') orgId: string, @Param('requestId') requestId: string, @Body() dto: UpdateRestockDto, @CurrentUser() caller: any) {
    return this.restock.update(orgId, requestId, caller, dto);
  }
}
