import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../supabase/supabase.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TontinesService } from './tontines.service';

const MAX_REMINDER_LOOKAHEAD_DAYS = 14; // matches the reminder_days_before CHECK upper bound

/**
 * The first scheduled job in this codebase (no cron infra existed before —
 * see @nestjs/schedule added alongside this file). Reminders and overdue
 * escalation are notification-only, as originally designed — but
 * runAutoPayments() below is a deliberate, later, narrower exception: it
 * only ever moves money for a contribution whose member has explicitly
 * opted in (tontine_members.auto_payment_opt_in), on top of the group's own
 * admin-set schedule. Nobody's wallet is touched without that personal
 * consent, however the group is configured.
 */
@Injectable()
export class TontinesCronService {
  private readonly logger = new Logger(TontinesCronService.name);

  constructor(
    private supabaseService: SupabaseService,
    private notificationsService: NotificationsService,
    private tontinesService: TontinesService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async checkDueDates() {
    await this.sendUpcomingReminders();
    await this.escalateOverdue();
    await this.runAutoPayments();
  }

  private async sendUpcomingReminders() {
    const maxLookahead = new Date();
    maxLookahead.setDate(maxLookahead.getDate() + MAX_REMINDER_LOOKAHEAD_DAYS);
    const cutoff = maxLookahead.toISOString().slice(0, 10);

    const { data: due, error } = await this.db
      .from('tontine_contributions')
      .select('id, group_id, member_id, due_date, amount_cents, currency')
      .eq('status', 'pending')
      .is('reminder_sent_at', null)
      .lte('due_date', cutoff);

    if (error || !due?.length) return;

    for (const contribution of due) {
      try {
        const { data: group } = await this.db
          .from('tontine_groups')
          .select('name, reminder_days_before')
          .eq('id', contribution.group_id)
          .single();
        if (!group) continue;

        // Each group picks its own reminder lead time — only send once the
        // due date actually falls within THIS group's window.
        const reminderCutoff = new Date();
        reminderCutoff.setDate(reminderCutoff.getDate() + group.reminder_days_before);
        if (contribution.due_date > reminderCutoff.toISOString().slice(0, 10)) continue;

        const { data: member } = await this.db
          .from('tontine_members')
          .select('user_id')
          .eq('id', contribution.member_id)
          .single();
        if (!member) continue;

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

  /** For each group that opted into auto-payment, pays any current-cycle
   * contribution whose due date lands exactly on the group's configured
   * lead time (0/2/4 days before) — but only for members who separately
   * opted in themselves (tontine_members.auto_payment_opt_in). The admin's
   * group-level setting is just a schedule; it authorizes nobody else's
   * money to move on its own. */
  private async runAutoPayments() {
    const { data: groups, error } = await this.db
      .from('tontine_groups')
      .select('id, name, current_cycle, auto_payment_days_before')
      .eq('auto_payment_enabled', true)
      .eq('status', 'active');

    if (error || !groups?.length) return;

    for (const group of groups) {
      try {
        const { data: cycle } = await this.db
          .from('tontine_cycles')
          .select('id')
          .eq('group_id', group.id)
          .eq('cycle_number', group.current_cycle)
          .maybeSingle();
        if (!cycle) continue;

        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + group.auto_payment_days_before);
        const targetDateStr = targetDate.toISOString().slice(0, 10);

        const { data: contributions } = await this.db
          .from('tontine_contributions')
          .select('id, group_id, cycle_id, member_id, amount_cents, currency, due_date')
          .eq('cycle_id', cycle.id)
          .eq('status', 'pending')
          .eq('due_date', targetDateStr);

        if (!contributions?.length) continue;

        for (const contribution of contributions) {
          const { data: member } = await this.db
            .from('tontine_members')
            .select('auto_payment_opt_in')
            .eq('id', contribution.member_id)
            .single();

          if (!member?.auto_payment_opt_in) continue;

          // autoContribute() never throws — it notifies the member itself
          // on failure (e.g. insufficient balance) instead.
          await this.tontinesService.autoContribute(contribution);
        }
      } catch (err: any) {
        this.logger.warn(`Auto-payment run failed for group ${group.id}: ${err.message}`);
      }
    }
  }
}
