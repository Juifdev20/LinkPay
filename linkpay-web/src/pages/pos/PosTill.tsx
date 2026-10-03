import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { FormSheet } from '@/components/FormSheet';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PosPaymentSheet } from './PosPayment';
import { PosReceipt } from './PosReceipt';
import { posErrorMessage } from './PosPage';
import { formatCurrency } from '@/lib/utils';
import { Search, Trash2, PauseCircle, Loader2, ShieldAlert } from 'lucide-react';

const STAFF_ROLES = ['magasinier', 'vendeur', 'caissier', 'comptable'];

/**
 * The selling screen itself: product search/barcode → ticket lines
 * (same product merges, lines are voided — not deleted — with an
 * authorization PIN for staff) → HT/TVA/TTC totals → payment sheet
 * (cash, ScanLinkPay, or a mix) → receipt.
 */
export function PosTill({
  merchantId,
  currency,
  ticket,
  setTicket,
  ticketKey,
  clearTicket,
  onHeld,
}: {
  merchantId: string;
  currency: string;
  ticket: any;
  setTicket: (t: any) => void;
  ticketKey: string;
  clearTicket: () => void;
  onHeld: () => void;
}) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isStaff = STAFF_ROLES.includes(user?.role || '');
  const [error, setError] = useState('');

  const ensureTicket = async () => {
    if (ticket?.status === 'open') return ticket;
    const { data } = await api.post(`/merchants/${merchantId}/pos/tickets`, { currency });
    localStorage.setItem(ticketKey, data.id);
    setTicket(data);
    return data;
  };

  // ------------------------------------------------------------------
  // Product lookup: live name search, Enter = barcode (USB scanners type
  // the code then send Enter — same handler serves both).
  // ------------------------------------------------------------------
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const ticketCurrency = ticket?.currency || currency;

  const { data: results } = useQuery({
    queryKey: ['pos-search', merchantId, debouncedQuery, ticketCurrency],
    queryFn: async () =>
      (await api.get(`/merchants/${merchantId}/stock-items/search`, { params: { q: debouncedQuery } })).data,
    enabled: !!merchantId && debouncedQuery.length >= 2,
    select: (items: any[]) => items.filter((i) => i.currency === ticketCurrency),
  });

  const [adding, setAdding] = useState(false);
  const addProduct = async (item: any) => {
    setAdding(true);
    setError('');
    try {
      const t = await ensureTicket();
      const { data } = await api.post(`/merchants/${t.merchant_id}/pos/tickets/${t.id}/items`, {
        stock_item_id: item.id,
        quantity: 1,
      });
      setTicket(data);
    } catch (err: any) {
      setError(posErrorMessage(err, "Impossible d'ajouter l'article"));
    } finally {
      setAdding(false);
    }
  };

  const scanBarcode = async () => {
    const code = query.trim();
    if (!code) return;
    try {
      const { data: item } = await api.get(
        `/merchants/${merchantId}/stock-items/by-barcode/${encodeURIComponent(code)}`,
      );
      await addProduct(item);
      setQuery('');
    } catch {
      // Not a registered barcode — leave the name-search results visible.
    }
  };

  // ------------------------------------------------------------------
  // Line void — a staff member needs a colleague's till PIN to authorize;
  // owners void directly. The line stays on the ticket marked "Annulée".
  // ------------------------------------------------------------------
  const [voidTarget, setVoidTarget] = useState<any>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidPin, setVoidPin] = useState('');
  const [voiding, setVoiding] = useState(false);

  const confirmVoid = async () => {
    setVoiding(true);
    setError('');
    try {
      const { data } = await api.post(
        `/merchants/${merchantId}/pos/tickets/${ticket.id}/items/${voidTarget.id}/void`,
        { reason: voidReason || undefined, supervisor_pin: isStaff ? voidPin : undefined },
      );
      setTicket(data);
      setVoidTarget(null);
      setVoidReason('');
      setVoidPin('');
    } catch (err: any) {
      setError(posErrorMessage(err, "Impossible d'annuler la ligne"));
    } finally {
      setVoiding(false);
    }
  };

  // ------------------------------------------------------------------
  // Hold / cancel / payment.
  // ------------------------------------------------------------------
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paidTicket, setPaidTicket] = useState<any>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [holding, setHolding] = useState(false);

  const holdTicket = async () => {
    setHolding(true);
    setError('');
    try {
      await api.post(`/merchants/${merchantId}/pos/tickets/${ticket.id}/hold`, {});
      onHeld();
    } catch (err: any) {
      setError(posErrorMessage(err, 'Impossible de mettre en attente'));
    } finally {
      setHolding(false);
    }
  };

  const cancelTicket = async () => {
    try {
      await api.post(`/merchants/${merchantId}/pos/tickets/${ticket.id}/cancel`, {});
      clearTicket();
    } catch (err: any) {
      setError(posErrorMessage(err, "Impossible d'annuler le ticket"));
    }
  };

  const finishPaidTicket = (t: any) => {
    clearTicket();
    setPaidTicket(t);
    setPaymentOpen(false);
    queryClient.invalidateQueries({ queryKey: ['pos-search'] });
    queryClient.invalidateQueries({ queryKey: ['pos-sales', merchantId] });
  };

  const items: any[] = ticket?.items || [];
  const activeItems = items.filter((i) => i.status !== 'voided');
  const voidedItems = items.filter((i) => i.status === 'voided');
  const tvaRate = Number(ticket?.merchant?.pos_tva_rate_pct ?? 0);

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">
            {ticket ? `Ticket #${ticket.ticket_number ?? '—'}` : 'Nouvelle vente'}
          </CardTitle>
          {ticket && (
            <div className="flex items-center gap-3">
              <button
                onClick={holdTicket}
                disabled={holding || !activeItems.length}
                className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                <PauseCircle className="w-4 h-4" /> Attente
              </button>
              <button onClick={() => setConfirmCancel(true)} className="text-sm font-medium text-destructive hover:underline">
                Annuler
              </button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Rechercher un produit ou scanner un code-barres…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && scanBarcode()}
              autoFocus
            />
          </div>

          {query.trim().length >= 2 && results && (
            <div className="rounded-xl border border-border divide-y divide-border max-h-56 overflow-y-auto">
              {results.length ? (
                results.map((item: any) => (
                  <button
                    key={item.id}
                    disabled={adding}
                    onClick={() => addProduct(item)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-accent/50 disabled:opacity-50"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{item.name}</p>
                      {item.category && <p className="text-xs text-muted-foreground">{item.category}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-semibold text-foreground">{formatCurrency(item.unit_price_cents, item.currency)}</p>
                      <p className="text-xs text-muted-foreground">{item.quantity} en stock</p>
                    </div>
                  </button>
                ))
              ) : (
                <p className="px-3 py-3 text-sm text-muted-foreground">Aucun produit « {debouncedQuery} »</p>
              )}
            </div>
          )}

          {activeItems.length > 0 && (
            <div className="divide-y divide-border">
              {activeItems.map((item: any) => (
                <div key={item.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground truncate">{item.product_name_snapshot}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.quantity} × {formatCurrency(item.unit_price_cents_snapshot, ticket.currency)}
                    </p>
                  </div>
                  <p className="font-semibold text-foreground flex-shrink-0">{formatCurrency(item.line_total_cents, ticket.currency)}</p>
                  <button onClick={() => setVoidTarget(item)} className="text-muted-foreground hover:text-destructive flex-shrink-0" title="Annuler la ligne">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Voided lines stay visible — struck through — so the operator
              sees exactly what was removed from this ticket. */}
          {voidedItems.map((item: any) => (
            <div key={item.id} className="flex items-center gap-3 py-1.5 opacity-50">
              <div className="min-w-0 flex-1">
                <p className="text-sm line-through text-muted-foreground truncate">{item.product_name_snapshot}</p>
                <p className="text-xs text-muted-foreground">
                  Annulée{item.voided_reason ? ` — ${item.voided_reason}` : ''}
                </p>
              </div>
              <Badge variant="outline" className="text-xs">Annulée</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Totals HT / TVA / TTC */}
      {ticket && (
        <Card>
          <CardContent className="pt-6 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <p className="text-muted-foreground">Sous-total HT</p>
              <p className="font-medium text-foreground">{formatCurrency(ticket.subtotal_cents || 0, ticketCurrency)}</p>
            </div>
            <div className="flex items-center justify-between text-sm">
              <p className="text-muted-foreground">TVA ({tvaRate}%)</p>
              <p className="font-medium text-foreground">{formatCurrency(ticket.tva_cents || 0, ticketCurrency)}</p>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2">
              <p className="text-muted-foreground">Total TTC</p>
              <p className="text-2xl font-bold text-foreground">{formatCurrency(ticket.total_cents || 0, ticketCurrency)}</p>
            </div>
            <Button className="w-full mt-2" size="lg" onClick={() => setPaymentOpen(true)} disabled={!activeItems.length}>
              Encaisser
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Paid ticket confirmation → receipt */}
      {paidTicket && (
        <PosReceipt ticket={paidTicket} onClose={() => setPaidTicket(null)} />
      )}

      {paymentOpen && ticket && (
        <PosPaymentSheet
          merchantId={merchantId}
          ticket={ticket}
          onTicketUpdate={setTicket}
          onPaid={finishPaidTicket}
          onClose={() => setPaymentOpen(false)}
        />
      )}

      {/* Void line dialog — staff must get a colleague's PIN */}
      {voidTarget && (
        <FormSheet onClose={() => setVoidTarget(null)} title="Annuler la ligne">
          <div className="p-6 max-w-lg mx-auto space-y-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-destructive" />
              <p className="font-semibold text-foreground">Annuler cette ligne ?</p>
            </div>
            <p className="text-sm text-muted-foreground">
              {voidTarget.quantity} × {voidTarget.product_name_snapshot} — {formatCurrency(voidTarget.line_total_cents, ticket.currency)}
            </p>
            <div className="space-y-2">
              <Label htmlFor="void-reason">Motif (optionnel)</Label>
              <Input id="void-reason" placeholder="Erreur de scan, client a changé d'avis…" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
            </div>
            {isStaff && (
              <div className="space-y-2">
                <Label htmlFor="void-pin">Code PIN d'un autre employé (autorisation)</Label>
                <Input
                  id="void-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="••••"
                  value={voidPin}
                  onChange={(e) => setVoidPin(e.target.value.replace(/\D/g, ''))}
                />
                <p className="text-xs text-muted-foreground">Un collègue ou superviseur saisit son propre code PIN de caisse.</p>
              </div>
            )}
            <Button variant="destructive" className="w-full" disabled={voiding || (isStaff && voidPin.length < 4)} onClick={confirmVoid}>
              {voiding && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
              Annuler la ligne
            </Button>
          </div>
        </FormSheet>
      )}

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Annuler ce ticket ?"
        description="Le ticket sera clôturé sans encaissement."
        confirmLabel="Annuler le ticket"
        variant="destructive"
        onConfirm={cancelTicket}
      />
    </div>
  );
}
