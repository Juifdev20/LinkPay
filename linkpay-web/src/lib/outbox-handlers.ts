import api from './api';
import { registerOutboxHandler } from './outbox';

/**
 * Every kind of operation the app can do offline, and how it reaches the server. Loaded once at start (main.tsx), so
 * what waits is sent even if its screen is never opened again. Each one sends op.id as client_ref: the server keeps
 * one copy whatever the number of sends.
 */

export interface ExpenseEntryPayload {
  report_id: string;
  amount_cents: number;
  currency: 'CDF' | 'USD';
  description?: string;
  noted_at: string;
}

registerOutboxHandler('expense.entry', {
  send: (op) => {
    const p = op.payload as ExpenseEntryPayload;
    return api.post(`/expense-tracker/reports/${p.report_id}/entries`, {
      amount_cents: p.amount_cents,
      currency: p.currency,
      description: p.description,
      client_ref: op.id,
      noted_at: p.noted_at,
    });
  },
  invalidate: () => [['expense-report-current'], ['expense-reports']],
});
