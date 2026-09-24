import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { SupabaseService } from '../supabase/supabase.service';
import { PspFactory } from '../payments/psp/psp.factory';
import { NotificationsService } from '../notifications/notifications.service';
import { WalletPinService } from '../wallets/wallet-pin.service';
import { sumByCurrency } from '../common/utils/currency';

/**
 * Personal expense tracker ("gestion de dépenses"), available to every role
 * EXCEPT enterprise (organizations have their own separate, richer expense
 * feature — see OrganizationsService.getExpensesSummary() and the
 * `organization_expenses` table — deliberately not touched here).
 *
 * A user creates a report, logs expenses against it, then closes it to lock
 * it — any number of reports per day, sequentially (close one before
 * starting the next). A closed report's PDF is generated client-side from
 * getPdfData()'s payload — see linkpay-web/src/lib/expense-pdf.ts.
 *
 * Gated behind a free trial limited by REPORT COUNT (not time) — the
 * super_admin sets how many reports a user may create-and-close for free;
 * that limit is snapshotted onto the user's own expense_pro_status row the
 * moment they choose the trial plan, so a later admin change never shifts
 * an already-running trial. A user can instead pay upfront for "unlimited"
 * (skipping the trial entirely), or upgrade once their trial count is
 * exhausted. Exhausted/expired = read-only: past closed reports and their
 * PDFs stay visible, but no new reports, entries, or closes.
 */
@Injectable()
export class ExpenseTrackerService {
  private readonly logger = new Logger(ExpenseTrackerService.name);

  constructor(
    private supabaseService: SupabaseService,
    private pspFactory: PspFactory,
    private notificationsService: NotificationsService,
    private configService: ConfigService,
    private walletPinService: WalletPinService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  // ==========================================================================
  // Plan / trial / Pro status
  // ==========================================================================

  private async getSettings() {
    const { data } = await this.db.from('expense_tracker_settings').select('*').eq('id', 1).single();
    return data;
  }

  private async getProStatus(userId: string) {
    const { data } = await this.db.from('expense_pro_status').select('*').eq('user_id', userId).maybeSingle();
    return data;
  }

  private isReadOnly(status: { plan: string; trial_report_limit: number; trial_reports_used: number; pro_expires_at: string | null }): boolean {
    if (status.plan === 'unlimited') {
      return !status.pro_expires_at || Date.now() >= new Date(status.pro_expires_at).getTime();
    }
    return status.trial_reports_used >= status.trial_report_limit;
  }

  /** Called at the top of every WRITE action (create report, add entry, close) — never in read routes. */
  private async assertNotReadOnly(userId: string): Promise<{ plan: string; trial_report_limit: number; trial_reports_used: number; pro_expires_at: string | null }> {
    const status = await this.getProStatus(userId);
    if (!status) {
      throw new ForbiddenException("Veuillez choisir votre offre (essai gratuit ou illimité) avant de commencer.");
    }
    if (this.isReadOnly(status)) {
      throw new ForbiddenException(
        status.plan === 'trial'
          ? "Vous avez atteint la limite de dépenses de votre essai gratuit. Passez en mode illimité pour continuer."
          : "Votre abonnement illimité a expiré. Renouvelez-le pour continuer à ajouter des dépenses.",
      );
    }
    return status;
  }

  async getStatus(userId: string) {
    const [status, settings] = await Promise.all([this.getProStatus(userId), this.getSettings()]);

    if (!status) {
      return {
        needs_plan_selection: true,
        trial_report_limit: settings?.trial_report_limit,
        monthly_price_cents: settings?.monthly_price_cents,
        monthly_price_currency: settings?.monthly_price_currency,
      };
    }

    return {
      needs_plan_selection: false,
      plan: status.plan,
      trial_report_limit: status.trial_report_limit,
      trial_reports_used: status.trial_reports_used,
      pro_expires_at: status.pro_expires_at,
      read_only: this.isReadOnly(status),
      monthly_price_cents: settings?.monthly_price_cents,
      monthly_price_currency: settings?.monthly_price_currency,
    };
  }

  /** First-ever choice: the free, count-limited trial. Choosing "unlimited" instead just means paying directly (activateProViaWallet/CinetPay below), no separate call needed. */
  async choosePlan(userId: string) {
    const existing = await this.getProStatus(userId);
    if (existing) {
      throw new BadRequestException('Une offre a déjà été choisie pour ce compte.');
    }

    const settings = await this.getSettings();
    const trialReportLimit = settings?.trial_report_limit ?? 3;

    const { data: created, error } = await this.db
      .from('expense_pro_status')
      .insert({ user_id: userId, plan: 'trial', trial_report_limit: trialReportLimit, trial_reports_used: 0 })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create expense pro status: ${error.message}`);
    }
    return created;
  }

  // ==========================================================================
  // Reports / entries
  // ==========================================================================

  async listReports(userId: string) {
    const { data, error } = await this.db
      .from('expense_reports')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to list expense reports: ${error.message}`);
    }
    return data || [];
  }

  /** The open report, if any — does NOT create one (unlike v1's getOrCreateToday). */
  async getCurrentReport(userId: string) {
    const { data } = await this.db
      .from('expense_reports')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .maybeSingle();

    if (!data) return { report: null };
    return { report: await this.getReport(userId, data.id) };
  }

  /** Creates a new report — or returns the already-open one, idempotently, if the caller already has one (sequential flow: close before starting another). */
  async createReport(userId: string) {
    await this.assertNotReadOnly(userId);

    const { data: existing } = await this.db
      .from('expense_reports')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .maybeSingle();

    if (existing) return this.getReport(userId, existing.id);

    const { data: created, error } = await this.db
      .from('expense_reports')
      .insert({ user_id: userId, expense_date: new Date().toISOString().slice(0, 10) })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create expense report: ${error.message}`);
    }
    return { ...created, entries: [], totals: { CDF: 0, USD: 0 } };
  }

  private async getOwnReport(userId: string, reportId: string) {
    const { data: report } = await this.db.from('expense_reports').select('*').eq('id', reportId).eq('user_id', userId).maybeSingle();
    if (!report) {
      throw new NotFoundException('Dépense introuvable');
    }
    return report;
  }

  async getReport(userId: string, reportId: string) {
    const report = await this.getOwnReport(userId, reportId);
    const { data: entries } = await this.db
      .from('expense_entries')
      .select('*')
      .eq('report_id', reportId)
      .order('created_at', { ascending: false });

    return { ...report, entries: entries || [], totals: sumByCurrency(entries, 'amount_cents') };
  }

  /** Same payload as getReport(), always allowed even read-only — feeds the client-side PDF renderer. */
  async getPdfData(userId: string, reportId: string) {
    return this.getReport(userId, reportId);
  }

  async addEntry(userId: string, reportId: string, dto: { amount_cents: number; currency?: string; description?: string }) {
    await this.assertNotReadOnly(userId);
    const report = await this.getOwnReport(userId, reportId);

    if (report.status === 'closed') {
      throw new ForbiddenException('Cette dépense est déjà clôturée.');
    }

    const { data: entry, error } = await this.db
      .from('expense_entries')
      .insert({
        report_id: reportId,
        user_id: userId,
        amount_cents: dto.amount_cents,
        currency: dto.currency === 'USD' ? 'USD' : 'CDF',
        description: dto.description,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to add expense entry: ${error.message}`);
    }
    return entry;
  }

  /** Closing is what "generates" a report against the trial count — increments trial_reports_used by 1 when the caller is on the trial plan. */
  async closeReport(userId: string, reportId: string) {
    const status = await this.assertNotReadOnly(userId);
    const report = await this.getOwnReport(userId, reportId);

    if (report.status === 'closed') {
      throw new ForbiddenException('Cette dépense est déjà clôturée.');
    }

    const { data: updated, error } = await this.db
      .from('expense_reports')
      .update({ status: 'closed', closed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', reportId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to close expense report: ${error.message}`);
    }

    if (status.plan === 'trial') {
      await this.db
        .from('expense_pro_status')
        .update({ trial_reports_used: status.trial_reports_used + 1, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
    }

    return this.getReport(userId, updated.id);
  }

  // ==========================================================================
  // Pro activation
  // ==========================================================================

  async activateProViaWallet(userId: string, pin: string) {
    await this.walletPinService.verifyPin(userId, pin);

    const settings = await this.getSettings();
    if (!settings) {
      throw new Error('Expense tracker settings not configured');
    }

    const { data: wallet } = await this.db.from('wallets').select('id').eq('user_id', userId).single();
    if (!wallet) {
      throw new NotFoundException('Wallet introuvable');
    }

    const reference = `EXPRO-WALLET-${uuidv4().slice(0, 8).toUpperCase()}`;

    const { data: newExpiry, error } = await this.db.rpc('pay_expense_pro_via_wallet', {
      p_user_id: userId,
      p_wallet_id: wallet.id,
      p_amount_cents: settings.monthly_price_cents,
      p_currency: settings.monthly_price_currency,
      p_reference: reference,
    });

    if (error) {
      throw new BadRequestException(error.message.includes('Insufficient') ? 'Solde insuffisant' : "Échec de l'activation Pro");
    }

    await this.db.from('expense_pro_payments').insert({
      user_id: userId,
      amount_cents: settings.monthly_price_cents,
      currency: settings.monthly_price_currency,
      payment_method: 'wallet',
      status: 'SUCCESS',
      extended_to: newExpiry,
    });

    return { pro_expires_at: newExpiry };
  }

  async activateProViaCinetPay(userId: string) {
    const settings = await this.getSettings();
    if (!settings) {
      throw new Error('Expense tracker settings not configured');
    }

    const { data: profile } = await this.db.from('profiles').select('full_name, email, phone').eq('id', userId).single();

    const adapter = this.pspFactory.get();
    const provider = adapter.provider;
    const reference = `EXPRO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${uuidv4().slice(0, 6).toUpperCase()}`;

    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:5173');
    const backendUrl = this.configService.get<string>('BACKEND_URL')
      || this.configService.get<string>('RENDER_EXTERNAL_URL')
      || `http://localhost:${this.configService.get<number>('PORT', 3000)}`;

    let pspResult;
    try {
      pspResult = await adapter.createPaymentIntent({
        amount_cents: settings.monthly_price_cents,
        currency: settings.monthly_price_currency,
        reference,
        customer: { email: profile?.email, phone: profile?.phone, name: profile?.full_name },
        redirect_url: `${frontendUrl}/dashboard/expenses/pro/result?ref=${reference}`,
        webhook_url: `${backendUrl}/api/v1/webhooks/${provider}`,
        metadata: { kind: 'expense_pro_subscription', user_id: userId },
      });
    } catch (err: any) {
      this.logger.error(`Expense Pro CinetPay init failed: ${err.message}`, err.stack);
      throw new BadRequestException("Impossible d'initialiser le paiement. Veuillez réessayer ou contacter le support.");
    }

    const { data: payment, error } = await this.db
      .from('expense_pro_payments')
      .insert({
        user_id: userId,
        amount_cents: settings.monthly_price_cents,
        currency: settings.monthly_price_currency,
        payment_method: 'cinetpay',
        status: 'PENDING',
        psp_provider: provider,
        psp_intent_id: pspResult.psp_intent_id,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create expense pro payment: ${error.message}`);
    }

    // Mock PSP has no real checkout/webhook delivery — same short-circuit
    // pattern as WalletsService.initiateTopup()'s mock branch.
    if (provider === 'mock') {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const { data: newExpiry } = await this.db.rpc('extend_expense_pro', { p_user_id: userId });
      await this.db.from('expense_pro_payments').update({ status: 'SUCCESS', extended_to: newExpiry }).eq('id', payment.id);
      return { payment: { ...payment, status: 'SUCCESS', extended_to: newExpiry }, pro_expires_at: newExpiry };
    }

    return { payment, checkout_url: pspResult.checkout_url };
  }

  async getProPaymentStatus(userId: string, reference: string) {
    const { data: payment } = await this.db
      .from('expense_pro_payments')
      .select('*')
      .eq('psp_intent_id', reference)
      .eq('user_id', userId)
      .maybeSingle();

    if (!payment) {
      throw new NotFoundException('Paiement introuvable');
    }

    if (payment.status === 'PENDING') {
      const adapter = this.pspFactory.get(payment.psp_provider);
      const live = await adapter.getTransactionStatus(payment.psp_intent_id);
      if (live.status === 'SUCCESS') {
        const { data: newExpiry } = await this.db.rpc('extend_expense_pro', { p_user_id: userId });
        await this.db.from('expense_pro_payments').update({ status: 'SUCCESS', extended_to: newExpiry, updated_at: new Date().toISOString() }).eq('id', payment.id);
      } else if (live.status === 'FAILED') {
        await this.db.from('expense_pro_payments').update({ status: 'FAILED', updated_at: new Date().toISOString() }).eq('id', payment.id);
      }
    }

    const { data: refreshed } = await this.db.from('expense_pro_payments').select('*').eq('id', payment.id).single();
    return refreshed;
  }

  // ==========================================================================
  // Admin config
  // ==========================================================================

  async getAdminSettings() {
    return this.getSettings();
  }

  async updateAdminSettings(
    adminUserId: string,
    dto: { trial_report_limit?: number; monthly_price_cents?: number; monthly_price_currency?: string },
  ) {
    const updates: Record<string, any> = { updated_by: adminUserId, updated_at: new Date().toISOString() };
    if (dto.trial_report_limit !== undefined) updates.trial_report_limit = dto.trial_report_limit;
    if (dto.monthly_price_cents !== undefined) updates.monthly_price_cents = dto.monthly_price_cents;
    if (dto.monthly_price_currency !== undefined) updates.monthly_price_currency = dto.monthly_price_currency;

    const { data, error } = await this.db.from('expense_tracker_settings').update(updates).eq('id', 1).select().single();
    if (error) {
      throw new Error(`Failed to update expense tracker settings: ${error.message}`);
    }
    return data;
  }
}
