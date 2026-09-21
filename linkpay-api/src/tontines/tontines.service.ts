import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { randomInt, randomUUID } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { WalletsService } from '../wallets/wallets.service';
import { NotificationsService } from '../notifications/notifications.service';

interface CreateGroupData {
  name: string;
  description?: string;
  contribution_amount_cents: number;
  currency: string;
  frequency: 'weekly' | 'monthly' | 'custom';
  custom_interval_days?: number;
  max_members: number;
  grace_period_days?: number;
}

/**
 * Rotating savings group (tontine/likelemba). Deliberately holds no money
 * itself — every cycle's contribution is a direct wallet-to-wallet transfer
 * (WalletsService.transfer(), unchanged) straight from a member to that
 * cycle's recipient. This service only tracks who owes what to whom and by
 * when, and orchestrates the random draw + cycle advancement. See
 * migration 016_tontines.sql for the schema.
 */
@Injectable()
export class TontinesService {
  private readonly logger = new Logger(TontinesService.name);

  constructor(
    private supabaseService: SupabaseService,
    private walletsService: WalletsService,
    private notificationsService: NotificationsService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  async createGroup(creatorId: string, data: CreateGroupData) {
    const { data: group, error } = await this.db
      .from('tontine_groups')
      .insert({
        name: data.name,
        description: data.description,
        creator_id: creatorId,
        contribution_amount_cents: data.contribution_amount_cents,
        currency: data.currency,
        frequency: data.frequency,
        custom_interval_days: data.frequency === 'custom' ? data.custom_interval_days : null,
        max_members: data.max_members,
        grace_period_days: data.grace_period_days ?? 3,
        status: 'forming',
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create tontine group: ${error.message}`);
    }

    const { data: member, error: memberError } = await this.db
      .from('tontine_members')
      .insert({
        group_id: group.id,
        user_id: creatorId,
        join_order: 1,
        status: 'active',
        accepted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (memberError) {
      throw new Error(`Failed to add creator as member: ${memberError.message}`);
    }

    return { group, member };
  }

  async getGroupById(id: string) {
    const { data, error } = await this.db.from('tontine_groups').select('*').eq('id', id).single();
    if (error || !data) {
      throw new NotFoundException('Tontine introuvable');
    }
    return data;
  }

  private async assertIsMember(groupId: string, userId: string) {
    const { data } = await this.db
      .from('tontine_members')
      .select('*')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!data) {
      throw new ForbiddenException('Vous ne faites pas partie de cette tontine');
    }
    return data;
  }

  async getMyGroups(userId: string) {
    // Excludes 'declined' — a refused invitation should disappear from "My
    // tontines", not linger there forever alongside real memberships.
    const { data: memberships, error } = await this.db
      .from('tontine_members')
      .select('status, payout_position, group:tontine_groups(*)')
      .eq('user_id', userId)
      .neq('status', 'declined');

    if (error) {
      throw new Error(`Failed to fetch tontines: ${error.message}`);
    }

    return (memberships || [])
      .filter((m: any) => m.group)
      .map((m: any) => ({
        group: m.group,
        my_status: m.status,
        my_payout_position: m.payout_position,
      }));
  }

  async getGroupDetail(groupId: string, userId: string) {
    await this.assertIsMember(groupId, userId);
    const group = await this.getGroupById(groupId);

    const { data: members } = await this.db
      .from('tontine_members')
      .select('id, user_id, join_order, payout_position, status, auto_payment_opt_in')
      .eq('group_id', groupId)
      .order('join_order', { ascending: true });

    const userIds = (members || []).map((m: any) => m.user_id);
    const { data: profiles } = userIds.length
      ? await this.db.from('profiles').select('id, full_name, phone').in('id', userIds)
      : { data: [] as any[] };
    const profilesById = Object.fromEntries((profiles || []).map((p: any) => [p.id, p]));

    const membersWithNames = (members || []).map((m: any) => ({
      ...m,
      display_name: profilesById[m.user_id]?.full_name || 'Membre ScanLinkPay',
    }));

    let currentCycle: any = null;
    if (group.current_cycle > 0) {
      const { data: cycle } = await this.db
        .from('tontine_cycles')
        .select('*')
        .eq('group_id', groupId)
        .eq('cycle_number', group.current_cycle)
        .maybeSingle();

      if (cycle) {
        const { data: contributions } = await this.db
          .from('tontine_contributions')
          .select('*')
          .eq('cycle_id', cycle.id);

        const recipient = membersWithNames.find((m) => m.id === cycle.recipient_member_id);
        currentCycle = {
          ...cycle,
          recipient,
          contributions: (contributions || []).map((c: any) => ({
            ...c,
            member: membersWithNames.find((m) => m.id === c.member_id),
            effective_amount_cents: this.computePenalizedAmount(c, group),
          })),
        };
      }
    }

    const { data: paidContributions } = await this.db
      .from('tontine_contributions')
      .select('id, member_id, amount_cents, currency, paid_at, cycle:tontine_cycles(cycle_number)')
      .eq('group_id', groupId)
      .eq('status', 'paid')
      .order('paid_at', { ascending: false });

    const contributionHistory = (paidContributions || []).map((c: any) => ({
      ...c,
      member: membersWithNames.find((m) => m.id === c.member_id),
    }));

    return { group, members: membersWithNames, current_cycle: currentCycle, contribution_history: contributionHistory };
  }

  /** Creator-only. Validates the same invariants as the DB CHECK constraints
   * in migration 020_tontine_settings.sql, so the caller gets a clear
   * message instead of a raw Postgres error. */
  async updateSettings(
    groupId: string,
    callerId: string,
    dto: {
      description?: string;
      reminder_days_before?: number;
      late_penalty_enabled?: boolean;
      late_penalty_percent_per_day?: number;
      auto_payment_enabled?: boolean;
      auto_payment_days_before?: number;
    },
  ) {
    const group = await this.getGroupById(groupId);
    if (group.creator_id !== callerId) {
      throw new ForbiddenException('Seul le créateur de la tontine peut modifier les réglages');
    }

    const lateEnabled = dto.late_penalty_enabled ?? group.late_penalty_enabled;
    const latePercent = dto.late_penalty_percent_per_day ?? group.late_penalty_percent_per_day;
    if (lateEnabled && (latePercent === null || latePercent === undefined)) {
      throw new BadRequestException('Précisez le pourcentage de pénalité par jour de retard');
    }

    const autoEnabled = dto.auto_payment_enabled ?? group.auto_payment_enabled;
    const autoDays = dto.auto_payment_days_before ?? group.auto_payment_days_before;
    if (autoEnabled && (autoDays === null || autoDays === undefined)) {
      throw new BadRequestException("Précisez à combien de jours avant l'échéance le paiement automatique doit se déclencher");
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.reminder_days_before !== undefined) updates.reminder_days_before = dto.reminder_days_before;
    if (dto.late_penalty_enabled !== undefined) updates.late_penalty_enabled = dto.late_penalty_enabled;
    if (dto.late_penalty_percent_per_day !== undefined) updates.late_penalty_percent_per_day = dto.late_penalty_percent_per_day;
    if (dto.auto_payment_enabled !== undefined) updates.auto_payment_enabled = dto.auto_payment_enabled;
    if (dto.auto_payment_days_before !== undefined) updates.auto_payment_days_before = dto.auto_payment_days_before;

    const { data: updated, error } = await this.db
      .from('tontine_groups')
      .update(updates)
      .eq('id', groupId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update tontine settings: ${error.message}`);
    }
    return { group: updated };
  }

  /** Any active member toggles auto-payment for their OWN contributions —
   * the group-level auto_payment_enabled/auto_payment_days_before only sets
   * the schedule; nothing is ever debited from a member's wallet without
   * this per-member consent too (see runAutoPayments() in the cron). */
  async setAutoPaymentOptIn(groupId: string, userId: string, enabled: boolean) {
    const member = await this.assertIsMember(groupId, userId);

    const { data: updated, error } = await this.db
      .from('tontine_members')
      .update({ auto_payment_opt_in: enabled })
      .eq('id', member.id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update auto-payment opt-in: ${error.message}`);
    }
    return { member: updated };
  }

  async inviteMember(groupId: string, callerId: string, walletNumber: string) {
    const group = await this.getGroupById(groupId);
    if (group.creator_id !== callerId) {
      throw new ForbiddenException("Seul le créateur de la tontine peut inviter des membres");
    }
    if (group.status === 'completed' || group.status === 'cancelled') {
      throw new BadRequestException('Cette tontine est terminée — impossible d\'ajouter des membres');
    }
    // A group already running (post-draw) can still grow: the newcomer is
    // simply appended to the back of the payout queue in respondToInvite
    // below, never inserted ahead of someone still waiting their turn.
    if (group.status === 'active' && group.max_members >= 30) {
      throw new BadRequestException('Cette tontine a atteint la taille maximale (30 membres)');
    }

    // Public masked lookup for a friendly display name, same helper used by
    // the "Envoyer" flow — but we also need the raw user_id to store the
    // membership row, which that masked shape deliberately omits.
    const publicInfo = await this.walletsService.lookupWallet(walletNumber);
    const { data: walletRow } = await this.db
      .from('wallets')
      .select('user_id')
      .eq('wallet_number', publicInfo.wallet_number)
      .single();

    if (!walletRow) {
      throw new NotFoundException('Numéro ScanLinkPay introuvable');
    }

    const { data: existing } = await this.db
      .from('tontine_members')
      .select('id, status')
      .eq('group_id', groupId)
      .eq('user_id', walletRow.user_id)
      .maybeSingle();
    // A 'declined' row doesn't block a fresh invite — someone can always
    // change their mind, or the admin may have meant to re-invite after a
    // mistaken refusal. Any other status (invited/active) still blocks.
    if (existing && existing.status !== 'declined') {
      throw new BadRequestException('Cette personne fait déjà partie de la tontine');
    }

    const { count: memberCount } = await this.db
      .from('tontine_members')
      .select('*', { count: 'exact', head: true })
      .eq('group_id', groupId)
      .neq('status', 'declined');

    if (group.status === 'forming' && (memberCount || 0) >= group.max_members) {
      throw new BadRequestException('Cette tontine est déjà complète');
    }

    let member: any;
    let error: any;
    if (existing) {
      // Re-invite: reset the same row (group_id, user_id) is unique, so a
      // fresh INSERT would fail — instead of a new row.
      ({ data: member, error } = await this.db
        .from('tontine_members')
        .update({ status: 'invited', invited_at: new Date().toISOString(), accepted_at: null })
        .eq('id', existing.id)
        .select()
        .single());
    } else {
      ({ data: member, error } = await this.db
        .from('tontine_members')
        .insert({
          group_id: groupId,
          user_id: walletRow.user_id,
          join_order: (memberCount || 0) + 1,
          status: 'invited',
        })
        .select()
        .single());
    }

    if (error) {
      throw new Error(`Failed to invite member: ${error.message}`);
    }

    await this.notificationsService.create({
      user_id: walletRow.user_id,
      type: 'tontine_invite',
      title: 'Invitation à une tontine',
      body: `Vous avez été invité(e) à rejoindre la tontine "${group.name}" (${(group.contribution_amount_cents / 100).toLocaleString('fr-FR')} ${group.currency} par cycle).`,
      data: { group_id: groupId },
    }).catch(() => null);

    return { member };
  }

  /** Creator-only: withdraws a pending invitation sent by mistake. Only
   * 'invited' rows are eligible — an 'active' member has to be handled
   * differently (they hold a payout_position and possibly contributions,
   * not implemented here), and a 'declined' one is already gone from the
   * invitee's view. The row is deleted outright rather than marked
   * 'declined', since that status specifically means the invitee refused —
   * conflating an admin-initiated cancellation with that would be
   * misleading in the members list. */
  async cancelInvite(groupId: string, callerId: string, memberId: string) {
    const group = await this.getGroupById(groupId);
    if (group.creator_id !== callerId) {
      throw new ForbiddenException("Seul le créateur de la tontine peut annuler une invitation");
    }

    const { data: member } = await this.db
      .from('tontine_members')
      .select('id, status')
      .eq('id', memberId)
      .eq('group_id', groupId)
      .maybeSingle();

    if (!member) {
      throw new NotFoundException('Membre introuvable');
    }
    if (member.status !== 'invited') {
      throw new BadRequestException('Seules les invitations en attente peuvent être annulées');
    }

    const { error } = await this.db.from('tontine_members').delete().eq('id', memberId);
    if (error) {
      throw new Error(`Failed to cancel invite: ${error.message}`);
    }

    return { success: true };
  }

  async respondToInvite(groupId: string, userId: string, accept: boolean) {
    const { data: member } = await this.db
      .from('tontine_members')
      .select('*')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!member) {
      throw new NotFoundException('Invitation introuvable');
    }
    if (member.status !== 'invited') {
      throw new BadRequestException('Cette invitation a déjà été traitée');
    }

    const group = await this.getGroupById(groupId);
    const joiningActiveGroup = accept && group.status === 'active';

    const updates: Record<string, any> = {
      status: accept ? 'active' : 'declined',
      accepted_at: accept ? new Date().toISOString() : null,
    };

    // Joining a tontine that already started: append to the very back of the
    // payout queue (never ahead of someone still waiting their turn) and
    // extend the group by one cycle so the newcomer is guaranteed their turn
    // without displacing anyone already positioned.
    if (joiningActiveGroup) {
      const { data: lastPosition } = await this.db
        .from('tontine_members')
        .select('payout_position')
        .eq('group_id', groupId)
        .not('payout_position', 'is', null)
        .order('payout_position', { ascending: false })
        .limit(1)
        .maybeSingle();

      updates.payout_position = (lastPosition?.payout_position || 0) + 1;

      await this.db
        .from('tontine_groups')
        .update({ max_members: group.max_members + 1, updated_at: new Date().toISOString() })
        .eq('id', groupId);
    }

    const { data: updated, error } = await this.db
      .from('tontine_members')
      .update(updates)
      .eq('id', member.id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to respond to invite: ${error.message}`);
    }

    // The current cycle's contributions were generated before this member
    // existed — backfill their share for it. Future cycles pick up every
    // active member automatically (generateContributions), no backfill needed.
    if (joiningActiveGroup && group.current_cycle > 0) {
      const { data: cycle } = await this.db
        .from('tontine_cycles')
        .select('id, due_date')
        .eq('group_id', groupId)
        .eq('cycle_number', group.current_cycle)
        .maybeSingle();

      if (cycle) {
        await this.db.from('tontine_contributions').insert({
          cycle_id: cycle.id,
          group_id: groupId,
          member_id: updated.id,
          amount_cents: group.contribution_amount_cents,
          currency: group.currency,
          due_date: cycle.due_date,
        });
      }
    }

    return { member: updated };
  }

  /** Creator-only: once every invited member has responded and the active
   * count matches max_members exactly, draws a fair random payout order
   * (Fisher–Yates with crypto.randomInt, not Math.random()) and starts
   * cycle 1. */
  async drawOrder(groupId: string, callerId: string) {
    const group = await this.getGroupById(groupId);
    if (group.creator_id !== callerId) {
      throw new ForbiddenException('Seul le créateur de la tontine peut lancer le tirage');
    }
    if (group.status !== 'forming') {
      throw new BadRequestException('Le tirage a déjà eu lieu pour cette tontine');
    }

    const { data: activeMembers } = await this.db
      .from('tontine_members')
      .select('*')
      .eq('group_id', groupId)
      .eq('status', 'active');

    const members = activeMembers || [];
    if (members.length !== group.max_members) {
      throw new BadRequestException(
        `Il faut exactement ${group.max_members} membres actifs pour lancer le tirage (actuellement ${members.length}).`,
      );
    }

    // Fisher–Yates shuffle using a cryptographically secure RNG — fairness
    // here is the entire point of the feature.
    const shuffled = [...members];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    for (let i = 0; i < shuffled.length; i++) {
      await this.db.from('tontine_members').update({ payout_position: i + 1 }).eq('id', shuffled[i].id);
    }

    await this.db.from('tontine_groups').update({ status: 'active', current_cycle: 1, updated_at: new Date().toISOString() }).eq('id', groupId);

    const cycle = await this.createCycle(groupId, 1, shuffled[0].id, group.frequency, group.custom_interval_days);
    await this.generateContributions(cycle.id, groupId, shuffled[0].id, members, group.contribution_amount_cents, group.currency, cycle.due_date);

    for (const m of shuffled) {
      await this.notificationsService.create({
        user_id: m.user_id,
        type: 'tontine_started',
        title: 'La tontine a démarré !',
        body: `Le tirage au sort de "${group.name}" est fait — vous recevrez la cagnotte au tour n°${shuffled.findIndex((x) => x.id === m.id) + 1}.`,
        data: { group_id: groupId },
      }).catch(() => null);
    }

    return this.getGroupDetail(groupId, callerId);
  }

  private addInterval(date: Date, frequency: string, customIntervalDays?: number): Date {
    const next = new Date(date);
    if (frequency === 'weekly') {
      next.setDate(next.getDate() + 7);
    } else if (frequency === 'custom') {
      next.setDate(next.getDate() + (customIntervalDays || 1));
    } else {
      next.setMonth(next.getMonth() + 1);
    }
    return next;
  }

  private async createCycle(groupId: string, cycleNumber: number, recipientMemberId: string, frequency: string, customIntervalDays?: number) {
    const dueDate = this.addInterval(new Date(), frequency, customIntervalDays);
    const { data: cycle, error } = await this.db
      .from('tontine_cycles')
      .insert({
        group_id: groupId,
        cycle_number: cycleNumber,
        recipient_member_id: recipientMemberId,
        due_date: dueDate.toISOString().slice(0, 10),
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create cycle: ${error.message}`);
    }
    return cycle;
  }

  private async generateContributions(
    cycleId: string,
    groupId: string,
    recipientMemberId: string,
    allMembers: { id: string }[],
    amountCents: number,
    currency: string,
    dueDate: string,
  ) {
    const owers = allMembers.filter((m) => m.id !== recipientMemberId);
    if (!owers.length) return;

    const { error } = await this.db.from('tontine_contributions').insert(
      owers.map((m) => ({
        cycle_id: cycleId,
        group_id: groupId,
        member_id: m.id,
        amount_cents: amountCents,
        currency,
        due_date: dueDate,
      })),
    );

    if (error) {
      throw new Error(`Failed to generate contributions: ${error.message}`);
    }
  }

  /** Computes what's actually owed for one contribution right now: the
   * original amount, unless the group has a late penalty enabled AND the
   * grace period (the same grace_period_days already used to notify the
   * organizer) has elapsed since due_date — in which case it grows by
   * late_penalty_percent_per_day for every day past that grace cutoff,
   * simple (non-compounding) daily accrual, until paid. */
  private computePenalizedAmount(contribution: { amount_cents: number; due_date: string }, group: any): number {
    if (!group.late_penalty_enabled || !group.late_penalty_percent_per_day) {
      return contribution.amount_cents;
    }

    const graceCutoff = new Date(contribution.due_date);
    graceCutoff.setDate(graceCutoff.getDate() + (group.grace_period_days || 0));
    graceCutoff.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const daysLate = Math.floor((today.getTime() - graceCutoff.getTime()) / 86_400_000);
    if (daysLate <= 0) {
      return contribution.amount_cents;
    }

    const multiplier = 1 + (group.late_penalty_percent_per_day / 100) * daysLate;
    return Math.round(contribution.amount_cents * multiplier);
  }

  /** Shared by contribute() (member-initiated, PIN required) and
   * autoContribute() (cron-initiated, pre-authorized via
   * tontine_members.auto_payment_opt_in — no PIN) — resolves the recipient,
   * applies any late penalty, performs the real wallet transfer, and
   * advances the cycle/group exactly the same way either path. */
  private async executeContribution(
    group: any,
    cycle: any,
    contribution: any,
    payerUserId: string,
    pin: string,
    idempotencyKey: string,
    skipPinVerification: boolean,
  ) {
    const { data: recipientMember } = await this.db
      .from('tontine_members')
      .select('user_id')
      .eq('id', cycle.recipient_member_id)
      .single();
    if (!recipientMember) {
      throw new Error(`Tontine data inconsistency: recipient member ${cycle.recipient_member_id} not found`);
    }

    const { data: recipientWallet } = await this.db
      .from('wallets')
      .select('wallet_number')
      .eq('user_id', recipientMember.user_id)
      .single();
    if (!recipientWallet) {
      throw new Error(`Tontine data inconsistency: no wallet for recipient ${recipientMember.user_id}`);
    }

    const effectiveAmountCents = this.computePenalizedAmount(contribution, group);

    const result = await this.walletsService.transfer(
      payerUserId,
      {
        recipient_wallet_number: recipientWallet.wallet_number,
        amount_cents: effectiveAmountCents,
        currency: contribution.currency,
        description: `Tontine "${group.name}" — cycle ${cycle.cycle_number}`,
        pin,
      },
      idempotencyKey,
      { skipPinVerification },
    );

    await this.db
      .from('tontine_contributions')
      .update({
        status: 'paid',
        transfer_id: result.transfer.id,
        amount_cents: effectiveAmountCents,
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', contribution.id);

    const { count: pendingCount } = await this.db
      .from('tontine_contributions')
      .select('*', { count: 'exact', head: true })
      .eq('cycle_id', cycle.id)
      .neq('status', 'paid');

    let cycleCompleted = false;
    let groupCompleted = false;

    if ((pendingCount || 0) === 0) {
      cycleCompleted = true;
      await this.db.from('tontine_cycles').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', cycle.id);

      if (cycle.cycle_number >= group.max_members) {
        groupCompleted = true;
        await this.db.from('tontine_groups').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('id', group.id);
      } else {
        const { data: allMembers } = await this.db.from('tontine_members').select('id').eq('group_id', group.id).eq('status', 'active');
        const { data: nextRecipient } = await this.db
          .from('tontine_members')
          .select('id')
          .eq('group_id', group.id)
          .eq('payout_position', cycle.cycle_number + 1)
          .single();
        if (!nextRecipient) {
          throw new Error(`Tontine data inconsistency: no member at payout_position ${cycle.cycle_number + 1} for group ${group.id}`);
        }

        const nextCycle = await this.createCycle(group.id, cycle.cycle_number + 1, nextRecipient.id, group.frequency, group.custom_interval_days);
        await this.generateContributions(nextCycle.id, group.id, nextRecipient.id, allMembers || [], group.contribution_amount_cents, group.currency, nextCycle.due_date);
        await this.db.from('tontine_groups').update({ current_cycle: cycle.cycle_number + 1, updated_at: new Date().toISOString() }).eq('id', group.id);
      }
    }

    return {
      contribution: { ...contribution, status: 'paid', amount_cents: effectiveAmountCents },
      transfer: result.transfer,
      cycle_completed: cycleCompleted,
      group_completed: groupCompleted,
    };
  }

  /** The "Cotiser" action — pays the caller's share for the current cycle
   * via a real wallet-to-wallet transfer straight to this cycle's
   * recipient, reusing WalletsService.transfer() unchanged (PIN
   * verification, fees, limits, transfer_sent/transfer_received
   * notifications — all already handled there). */
  async contribute(groupId: string, callerId: string, pin: string, idempotencyKey: string) {
    const group = await this.getGroupById(groupId);
    const myMember = await this.assertIsMember(groupId, callerId);

    if (group.status !== 'active') {
      throw new BadRequestException('Cette tontine n\'est pas en cours');
    }

    const { data: cycle } = await this.db
      .from('tontine_cycles')
      .select('*')
      .eq('group_id', groupId)
      .eq('cycle_number', group.current_cycle)
      .single();

    if (!cycle) {
      throw new NotFoundException('Cycle en cours introuvable');
    }

    const { data: contribution } = await this.db
      .from('tontine_contributions')
      .select('*')
      .eq('cycle_id', cycle.id)
      .eq('member_id', myMember.id)
      .maybeSingle();

    if (!contribution) {
      throw new BadRequestException("Vous n'avez pas de cotisation en attente pour ce cycle (c'est peut-être votre tour de recevoir).");
    }
    if (contribution.status === 'paid') {
      throw new BadRequestException('Vous avez déjà cotisé pour ce cycle');
    }

    return this.executeContribution(group, cycle, contribution, callerId, pin, idempotencyKey, false);
  }

  /** Cron-only (see TontinesCronService.runAutoPayments) — pays on a
   * member's behalf without a PIN, since tontine_members.auto_payment_opt_in
   * already recorded their standing consent for this specific contribution.
   * Never throws to the caller: any failure (insufficient balance, etc.) is
   * caught and turned into a notification telling the member to pay
   * manually instead — a failed auto-payment attempt must never look like a
   * silent debt write-off, nor crash the whole cron run for other members. */
  async autoContribute(contribution: {
    id: string;
    group_id: string;
    cycle_id: string;
    member_id: string;
    amount_cents: number;
    currency: string;
    due_date: string;
  }) {
    const group = await this.getGroupById(contribution.group_id);
    const { data: cycle } = await this.db.from('tontine_cycles').select('*').eq('id', contribution.cycle_id).single();
    const { data: member } = await this.db.from('tontine_members').select('user_id').eq('id', contribution.member_id).single();

    if (!cycle || !member) {
      this.logger.warn(`autoContribute: missing cycle/member for contribution ${contribution.id}`);
      return;
    }

    try {
      await this.executeContribution(group, cycle, contribution, member.user_id, '', randomUUID(), true);
    } catch (err: any) {
      this.logger.warn(`Auto-payment failed for contribution ${contribution.id}: ${err.message}`);
      await this.notificationsService.create({
        user_id: member.user_id,
        type: 'tontine_auto_payment_failed',
        title: 'Paiement automatique échoué',
        body: `Le paiement automatique de ${(contribution.amount_cents / 100).toLocaleString('fr-FR')} ${contribution.currency} pour la tontine "${group.name}" a échoué (solde insuffisant ?). Merci de cotiser manuellement.`,
        data: { group_id: contribution.group_id },
      }).catch(() => null);
    }
  }
}
