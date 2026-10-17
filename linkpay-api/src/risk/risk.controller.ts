import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { RiskService } from './risk.service';

class ResolveRiskLogDto {
  @ApiProperty({ example: 'Vérifié avec le client, opération légitime' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  resolution!: string;
}

@ApiTags('Risk')
@ApiBearerAuth()
@Controller('risk-logs')
@UseGuards(RolesGuard)
@Roles('admin', 'super_admin')
export class RiskController {
  constructor(private riskService: RiskService, private auditService: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Suspicious operations flagged or blocked by the risk engine' })
  list(@Query('resolved') resolved?: string) {
    return this.riskService.getRiskLogs(resolved === undefined ? undefined : { resolved: resolved === 'true' });
  }

  @Post(':id/resolve')
  @ApiOperation({ summary: 'Mark a risk log as reviewed' })
  async resolve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveRiskLogDto, @CurrentUser('id') adminId: string) {
    const log = await this.riskService.resolveRiskLog(id, dto.resolution);
    await this.auditService.log({ user_id: adminId, action: 'RISK_LOG_RESOLVED', entity_type: 'risk_log', entity_id: id, changes: { resolution: dto.resolution } });
    return log;
  }
}
