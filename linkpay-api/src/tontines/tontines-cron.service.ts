import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * The first scheduled job in this codebase (no cron infra existed before —
 * see @nestjs/schedule added alongside this file). Two responsibilities,
 * both notification-only — contributions are always paid manually by the
 * member tapping "Cotiser" (see TontinesService.contribute()); this job
 * never moves money or locks anyone out, matching the product decision
 * that late payment is resolved socially, not by an automatic rule.
 */
@Injectable()
export class TontinesCronService {
  private readonly logger = new Logger(TontinesCronService.name);

  constructor(
    private supabaseService: SupabaseService,
    private notificationsService: NotificationsService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async checkDueDates() {
    await this.sendUpcomingReminders();
    await this.escalateOverdue();
  }

  private async sendUpcomingReminders() {
    const in2Days = new Date();
    in2Days.setDate(in2Days.getDate() + 2);
    const cutoff = in2Days.toISOString().slice(0, 10);

    const { data: due, error } = await this.db
      .from('tontine_contributions')
      .select('id, group_id, member_id, due_date, amount_cents, currency')
      .eq('status', 'pending')
      .is('reminder_sent_at', null)
      .lte('due_date', cutoff);

    if (error || !due?.length) return;

    for (const contribution of due) {
      try {
        const { data: member } = await this.db
          .from('tontine_members')
          .select('user_id')
          .eq('id', contribution.member_id)
          .single();
        const { data: group } = await this.db
          .from('tontine_groups')
          .select('name')
          .eq('id', contribution.group_id)
          .single();
        if (!member || !group) continue;

        await this.notificationsService.create({
          user_id: member.user_id,
          type: 'tontine_contribution_due',
          title: 'Cotisation à venir',
          body: `Votre cotisation de ${(contribution.amount_cents / 100).toLocaleString('fr-FR')} ${contribution.currency} pour la tontine "${group.name}" est due le ${contribution.due_date}.`,
          data: { group_id: contribution.group_id },
        });

        await this.db.from('tontine_contributions').update({ reminder_sent_at: new Date().toISOString() }).eq('id', contribution.id);
      } catch (err: any) {
        this.logger.warn(`Reminder failed for contribution ${contribution.id}: ${err.message}`);
      }
    }
  }

  private async escalateOverdue() {
    const today = new Date().toISOString().slice(0, 10);

    // Fetch already-past-due pending contributions, then filter by each
    // group's own grace_period_days in application code — the volume here
    // is small enough (early-stage product) that a cross-table computed
    // comparison isn't worth a raw SQL RPC.
    const { data: pastDue, error } = await this.db
      .from('tontine_contributions')
      .select('id, group_id, member_id, due_date, amount_cents, currency')
      .eq('status', 'pending')
      .is('overdue_notified_at', null)
      .lt('due_date', today);

    if (error || !pastDue?.length) return;

    for (const contribution of pastDue) {
      try {
        const { data: group } = await this.db
          .from('tontine_groups')
          .select('name, creator_id, grace_period_days')
          .eq('id', contribution.group_id)
          .single();
        if (!group) continue;

        const graceCutoff = new Date(contribution.due_date);
        graceCutoff.setDate(graceCutoff.getDate() + group.grace_period_days);
        if (graceCutoff.toISOString().slice(0, 10) >= today) continue; // still within grace period

        const { data: member } = await this.db
          .from('tontine_members')
          .select('user_id')
          .eq('id', contribution.member_id)
          .single();
        const { data: profile } = member
          ? await this.db.from('profiles').select('full_name').eq('id', member.user_id).maybeSingle()
          : { data: null };

        await this.db.from('tontine_contributions').update({ status: 'overdue' }).eq('id', contribution.id);

        await this.notificationsService.create({
          user_id: group.creator_id,
          type: 'tontine_contribution_overdue',
          title: 'Cotisation en retard',
          body: `${profile?.full_name || 'Un membre'} n'a pas encore cotisé pour la tontine "${group.name}" (échéance dépassée de plus de ${group.grace_period_days} jours).`,
          data: { group_id: contribution.group_id, member_id: contribution.member_id },
        });

        await this.db.from('tontine_contributions').update({ overdue_notified_at: new Date().toISOString() }).eq('id', contribution.id);
      } catch (err: any) {
        this.logger.warn(`Overdue escalation failed for contribution ${contribution.id}: ${err.message}`);
      }
    }
  }
}
