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

export interface OfflineSalePayload {
  merchant_id: string;
  currency: 'CDF' | 'USD';
  sold_at: string;
  items: { stock_item_id: string; quantity: number; unit_price_cents: number; name: string }[];
  received_cents: number;
}

/** A till sale made without network (cash). The server writes it once, whatever the number of sends. */
registerOutboxHandler('pos.offline-sale', {
  send: (op) => {
    const p = op.payload as OfflineSalePayload;
    return api.post(`/merchants/${p.merchant_id}/pos/offline-sales`, {
      client_ref: op.id,
      currency: p.currency,
      sold_at: p.sold_at,
      items: p.items.map(({ stock_item_id, quantity, unit_price_cents }) => ({ stock_item_id, quantity, unit_price_cents })),
      received_cents: p.received_cents,
    });
  },
  invalidate: (op) => [['pos-catalog', op.payload.merchant_id], ['pos-sales', op.payload.merchant_id], ['cash-session']],
});

/** A server ticket left open when the network dropped and finished offline: closed (cancelled) once back. */
registerOutboxHandler('pos.cancel-ticket', {
  send: (op) => api.post(`/merchants/${op.payload.merchant_id}/pos/tickets/${op.payload.ticket_id}/cancel`, { reason: 'Repris hors ligne (réseau coupé)' })
    .catch((err) => {
      // Already closed (paid or cancelled elsewhere): nothing left to do.
      if (err?.response?.status === 400 || err?.response?.status === 404) return;
      throw err;
    }),
  invalidate: (op) => [['pos-held', op.payload.merchant_id]],
});

export interface StockMovementPayload {
  merchant_id: string;
  item_id: string;
  org_id: string;
  type: 'in' | 'out' | 'adjustment';
  quantity_delta: number;
  reason?: string;
}

/** A stock reception / exit / correction made without network, applied once on the server. */
registerOutboxHandler('stock.movement', {
  send: (op) => {
    const p = op.payload as StockMovementPayload;
    return api.post(`/merchants/${p.merchant_id}/stock-items/${p.item_id}/movements`, {
      type: p.type,
      quantity_delta: p.quantity_delta,
      reason: p.reason,
      client_ref: op.id,
    });
  },
  invalidate: (op) => [['org-stock-items', op.payload.org_id], ['org-stock-summary', op.payload.org_id], ['pos-catalog', op.payload.merchant_id]],
});

export interface OrgOfflineSalePayload {
  org_id: string;
  sold_at: string;
  items: { stock_item_id: string; quantity: number; unit_price_cents: number; name: string }[];
}

/** A sale of the "Ventes" module made without network (cash), recorded once on the server. */
registerOutboxHandler('sales.offline', {
  send: (op) => {
    const p = op.payload as OrgOfflineSalePayload;
    return api.post(`/organizations/${p.org_id}/sales/offline`, {
      client_ref: op.id,
      sold_at: p.sold_at,
      items: p.items.map(({ stock_item_id, quantity, unit_price_cents }) => ({ stock_item_id, quantity, unit_price_cents })),
    });
  },
  invalidate: (op) => [['org-stock-items', op.payload.org_id], ['org-sales-stats', op.payload.org_id], ['org-sales-history', op.payload.org_id]],
});

/** "Encaissé en espèces" tapped without network on a sale already on the server. A refusal (paid meanwhile by
 * ScanLinkPay…) stays in Synchronisation for a person to check: cash may have been taken twice. */
registerOutboxHandler('sales.cash', {
  send: (op) => api.post(`/organizations/${op.payload.org_id}/sales/${op.payload.sale_id}/cash`),
  invalidate: (op) => [['org-sale', op.payload.org_id, op.payload.sale_id], ['org-stock-items', op.payload.org_id], ['org-sales-stats', op.payload.org_id]],
});

/** Quantities counted during an inventory without network. Setting a counted quantity is idempotent. */
registerOutboxHandler('inventory.lines', {
  send: (op) => api.patch(`/merchants/${op.payload.merchant_id}/inventory-counts/${op.payload.count_id}/lines`, { lines: op.payload.lines }),
  invalidate: (op) => [['inventory-count', op.payload.count_id]],
});

/** A restock request written without network, created once on the server. */
registerOutboxHandler('restock.request', {
  send: (op) => api.post(`/merchants/${op.payload.merchant_id}/restock-requests`, { ...op.payload.body, client_ref: op.id }),
  invalidate: () => [['restock-requests']],
});

/** Cash put in / taken out of the till drawer without network, recorded once. */
registerOutboxHandler('cash.movement', {
  send: (op) => api.post(`/merchants/${op.payload.merchant_id}/cash-register/sessions/${op.payload.session_id}/movements`, { ...op.payload.body, client_ref: op.id }),
  invalidate: (op) => [['cash-session-detail', op.payload.session_id]],
});
