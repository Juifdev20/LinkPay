import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { StockService, POS_SALE_ROLES } from '../stock/stock.service';
import { AuditService } from '../audit/audit.service';

/**
 * One open session per (store, currency) at a time — a till is opened with
 * a starting cash float, sales recorded against it, and closed by counting
 * the physical cash and comparing it to what the system expects
 * (float + cash sales + manual cash-in − manual cash-out).
 */
@Injectable()
export class CashRegisterService {
  constructor(
    private supabaseService: SupabaseService,
    private stockService: StockService,
    private auditService: AuditService,
  ) {}

  private get db() {
    return this.supabaseService.getClient();
  }

  private async assertAccess(merchantId: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    return this.stockService.resolveMerchantAccess(merchantId, callerId, callerRole, callerOrgId, POS_SALE_ROLES);
  }

  async getCurrentSession(merchantId: string, currency: string, callerId: string, callerRole: string, callerOrgId: string | undefined) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);

    const { data } = await this.db
      .from('cash_register_sessions')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('currency', currency)
      .eq('status', 'open')
      .maybeSingle();

    return { session: data || null };
  }

  async openSession(
    merchantId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    data: { currency: string; opening_float_cents: number },
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);

    const existing = await this.db
      .from('cash_register_sessions')
      .select('id')
      .eq('merchant_id', merchantId)
      .eq('currency', data.currency)
      .eq('status', 'open')
      .maybeSingle();

    if (existing.data) {
      throw new BadRequestException(`Une session de caisse en ${data.currency} est déjà ouverte pour cette boutique.`);
    }

    const { data: session, error } = await this.db
      .from('cash_register_sessions')
      .insert({
        merchant_id: merchantId,
        cashier_user_id: callerId,
        currency: data.currency,
        opening_float_cents: data.opening_float_cents,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to open cash register session: ${error.message}`);
    return session;
  }

  private async getOwnSession(merchantId: string, sessionId: string) {
    const { data, error } = await this.db
      .from('cash_register_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('merchant_id', merchantId)
      .single();

    if (error || !data) throw new NotFoundException('Session de caisse introuvable');
    return data;
  }

  async addMovement(
    merchantId: string,
    sessionId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    data: { type: 'cash_in' | 'cash_out'; amount_cents: number; reason?: string },
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const session = await this.getOwnSession(merchantId, sessionId);
    if (session.status !== 'open') {
      throw new BadRequestException('Cette session de caisse est déjà clôturée.');
    }

    const { data: movement, error } = await this.db
      .from('cash_movements')
      .insert({
        session_id: sessionId,
        type: data.type,
        amount_cents: data.amount_cents,
        reason: data.reason || null,
        created_by: callerId,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to record cash movement: ${error.message}`);
    return movement;
  }

  async closeSession(
    merchantId: string,
    sessionId: string,
    callerId: string,
    callerRole: string,
    callerOrgId: string | undefined,
    data: { closing_counted_cents: number },
  ) {
    await this.assertAccess(merchantId, callerId, callerRole, callerOrgId);
    const session = await this.getOwnSession(merchantId, sessionId);
    if (session.status !== 'open') {
      throw new BadRequestException('Cette session de caisse est déjà clôturée.');
    }

    const { data: cashTickets } = await this.db
      .from('pos_tickets')
      .select('total_cents')
      .eq('cash_register_session_id', sessionId)
      .eq('payment_method', 'cash')
      .eq('status', 'paid');

    const { data: movements } = await this.db
      .from('cash_movements')
      .select('type, amount_cents')
      .eq('session_id', sessionId);

    const cashSales = (cashTickets || []).reduce((sum, t) => sum + t.total_cents, 0);
    const cashIn = (movements || []).filter((m) => m.type === 'cash_in').reduce((sum, m) => sum + m.amount_cents, 0);
    const cashOut = (movements || []).filter((m) => m.type === 'cash_out').reduce((sum, m) => sum + m.amount_cents, 0);
    const expected = session.opening_float_cents + cashSales + cashIn - cashOut;
    const discrepancy = data.closing_counted_cents - expected;

    const { data: closed, error } = await this.db
      .from('cash_register_sessions')
      .update({
        status: 'closed',
        closing_counted_cents: data.closing_counted_cents,
        expected_cents: expected,
        discrepancy_cents: discrepancy,
        closed_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .eq('status', 'open')
      .select()
      .single();

    if (error || !closed) throw new BadRequestException('Cette session de caisse est déjà clôturée.');

    await this.auditService.log({
      user_id: callerId,
      action: 'cash_session_closed',
      entity_type: 'cash_register_session',
      entity_id: sessionId,
      changes: { expected_cents: expected, closing_counted_cents: data.closing_counted_cents, discrepancy_cents: discrepancy },
    });

    return closed;
  }
}
