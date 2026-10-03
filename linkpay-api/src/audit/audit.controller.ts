import { Controller, Get, Param, Query, UseGuards, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { SupabaseService } from '../supabase/supabase.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

/**
 * Organization-scoped audit trail (spec 3.2 "traçabilité") — the direction
 * reviews who did what: voided lines, cancelled tickets, price changes,
 * stock adjustments, session opens/closes, inventory validations. Scoped
 * to the user_ids of the org's owner + staff, so a cashier's till actions
 * show up under their own name.
 */
@ApiTags('Audit')
@ApiBearerAuth()
@Controller('organizations/:id/audit-log')
@Roles('enterprise', 'comptable', 'admin', 'super_admin')
@UseGuards(RolesGuard)
export class AuditController {
  constructor(
    private auditService: AuditService,
    private supabaseService: SupabaseService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Journal d'activité de l'organisation (actions du propriétaire et des employés)" })
  async getOrgAuditLog(
    @Param('id') orgId: string,
    @Query('action') action: string | undefined,
    @Query('user_id') userId: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser('id') callerId: string,
    @CurrentUser('role') callerRole: string,
    @CurrentUser('organization_id') callerOrgId?: string,
  ) {
    const db = this.supabaseService.getClient();
    const { data: org } = await db.from('organizations').select('id, owner_id').eq('id', orgId).single();
    if (!org) throw new NotFoundException('Organisation introuvable');

    const isAdmin = callerRole === 'admin' || callerRole === 'super_admin';
    const isOwner = org.owner_id === callerId;
    const isStaff = callerOrgId === orgId && callerRole === 'comptable';
    if (!isAdmin && !isOwner && !isStaff) {
      throw new ForbiddenException("Vous n'avez pas accès au journal de cette organisation.");
    }

    const { data: staff } = await db.from('organization_staff').select('user_id').eq('organization_id', orgId);
    const userIds = [org.owner_id, ...(staff || []).map((s) => s.user_id)];

    // Optional per-user filter — restricted to users who actually belong to
    // this org (anything else matches nobody).
    const effectiveIds = userId ? (userIds.includes(userId) ? [userId] : ['00000000-0000-0000-0000-000000000000']) : userIds;

    return this.auditService.getAuditLogs({
      user_ids: effectiveIds,
      action,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
