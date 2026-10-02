import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/PageHeader';
import { FormSheet } from '@/components/FormSheet';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PaymentRequestShareCard } from '@/components/PaymentRequestShareCard';
import { CashierPinGate } from './CashierPinGate';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  Search, Banknote, QrCode, Trash2, CheckCircle,
  Lock, Store, Loader2, Vault, DoorClosed, DoorOpen,
} from 'lucide-react';

const STAFF_ROLES = ['magasinier', 'vendeur', 'caissier', 'comptable'];

function errorMessage(err: any, fallback: string) {
  const msg = err?.response?.data?.message;
  return Array.isArray(msg) ? msg.join(', ') : msg || fallback;
}

/**
 * Point of sale ("caisse") — one till per (store, currency), matching the
 * backend module. A cashier opens a cash-register session with a float,
 * builds a single-currency ticket by scanning/searching products, then
 * settles it either in cash or by showing the customer a ScanLinkPay QR
 * (stock is deducted only once the payment is actually confirmed — see
 * trySettleScanlinkpayTicket backend-side).
 */
export default function PosPage() {
  const user = useAuthStore((s) => s.user);
  const isStaff = STAFF_ROLES.includes(user?.role || '');
  // Remounting the gate re-runs its status check and drops `unlocked` —
  // that's the whole implementation of the "Verrouiller" button.
  const [gateKey, setGateKey] = useState(0);

  const till = <PosTill onLock={isStaff ? () => setGateKey((k) => k + 1) : undefined} />;
  return isStaff ? <CashierPinGate key={gateKey}>{till}</CashierPinGate> : till;
}

function PosTill({ onLock }: { onLock?: () => void }) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  // ------------------------------------------------------------------
  // Store + currency resolution. Merchants (incl. enterprise "acting as" a
  // store) already carry merchant_id in their JWT; enterprise owners at org
  // level and org-scoped staff don't — they pick among the org's stores
  // (auto-selected when there's exactly one, same pattern as Stock.tsx).
  // ------------------------------------------------------------------
  const [pickedMerchant, setPickedMerchant] = useState('');

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
    enabled: !user?.merchant_id,
  });

  const { data: merchants } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data,
    enabled: !user?.merchant_id && !!org?.id,
  });

  const merchantId = user?.merchant_id || pickedMerchant || (merchants?.length === 1 ? merchants[0].id : '');
  const merchantName = merchants?.find((m: any) => m.id === merchantId)?.name;

  const [currency, setCurrency] = useState<'CDF' | 'USD'>('CDF');
  const [error, setError] = useState('');

  // ------------------------------------------------------------------
  // Cash-register session — one open session per (store, currency).
  // ------------------------------------------------------------------
  const { data: sessionData, isLoading: sessionLoading } = useQuery({
    queryKey: ['cash-session', merchantId, currency],
    queryFn: async () => (await api.get(`/merchants/${merchantId}/cash-register/sessions/current`, { params: { currency } })).data,
    enabled: !!merchantId,
  });
  const session = sessionData?.session;
  const [openingFloat, setOpeningFloat] = useState('');
  const [opening, setOpening] = useState(false);

  const openSession = async () => {
    setOpening(true);
    setError('');
    try {
      await api.post(`/merchants/${merchantId}/cash-register/sessions`, {
        currency,
        opening_float_cents: Math.round(parseFloat(openingFloat || '0') * 100),
      });
      setOpeningFloat('');
      queryClient.invalidateQueries({ queryKey: ['cash-session', merchantId, currency] });
    } catch (err: any) {
      setError(errorMessage(err, "Impossible d'ouvrir la caisse"));
    } finally {
      setOpening(false);
    }
  };

  // ------------------------------------------------------------------
  // Current ticket — kept in localStorage keyed by (store, currency) so a
  // refresh or accidental navigation doesn't silently orphan the sale
  // (there's no "list open tickets" endpoint to recover it otherwise).
  // ------------------------------------------------------------------
  const ticketKey = merchantId ? `pos_ticket:${merchantId}:${currency}` : '';
  const [ticket, setTicket] = useState<any>(null);

  useEffect(() => {
    setTicket(null);
    if (!ticketKey) return;
    const id = localStorage.getItem(ticketKey);
    if (!id) return;
    api.get(`/merchants/${merchantId}/pos/tickets/${id}`)
      .then(({ data }) => {
        if (data.status === 'open') setTicket(data);
        else localStorage.removeItem(ticketKey);
      })
      .catch(() => localStorage.removeItem(ticketKey));
  }, [ticketKey]);

  const ensureTicket = async () => {
    if (ticket?.status === 'open') return ticket;
    const { data } = await api.post(`/merchants/${merchantId}/pos/tickets`, { currency });
    localStorage.setItem(ticketKey, data.id);
    setTicket(data);
    return data;
  };

  // ------------------------------------------------------------------
  // Product lookup: live name search, and Enter = barcode scan (USB
  // scanners type the code then send Enter — same handler serves both).
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
    enabled: !!merchantId && !!session && debouncedQuery.length >= 2,
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
      setError(errorMessage(err, "Impossible d'ajouter l'article"));
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

  const removeItem = async (itemRowId: string) => {
    try {
      const { data } = await api.delete(`/merchants/${merchantId}/pos/tickets/${ticket.id}/items/${itemRowId}`);
      setTicket(data);
    } catch (err: any) {
      setError(errorMessage(err, "Impossible de retirer l'article"));
    }
  };

  // ------------------------------------------------------------------
  // Settlement.
  // ------------------------------------------------------------------
  const [paidTicket, setPaidTicket] = useState<any>(null);
  const [paying, setPaying] = useState(false);
  const [qrRequest, setQrRequest] = useState<any>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const finishPaidTicket = (t: any) => {
    localStorage.removeItem(ticketKey);
    setTicket(null);
    setQrRequest(null);
    setPaidTicket(t);
    queryClient.invalidateQueries({ queryKey: ['pos-search'] });
  };

  const payCash = async () => {
    setPaying(true);
    setError('');
    try {
      const { data } = await api.post(`/merchants/${merchantId}/pos/tickets/${ticket.id}/pay/cash`);
      finishPaidTicket(data);
    } catch (err: any) {
      setError(errorMessage(err, 'Paiement impossible'));
    } finally {
      setPaying(false);
    }
  };

  const payScanlinkpay = async () => {
    setPaying(true);
    setError('');
    try {
      const { data } = await api.post(`/merchants/${merchantId}/pos/tickets/${ticket.id}/pay/scanlinkpay`);
      setTicket(data.ticket);
      setQrRequest(data.payment_request);
    } catch (err: any) {
      setError(errorMessage(err, 'Paiement impossible'));
    } finally {
      setPaying(false);
    }
  };

  const cancelTicket = async () => {
    try {
      await api.post(`/merchants/${merchantId}/pos/tickets/${ticket.id}/cancel`, {});
      localStorage.removeItem(ticketKey);
      setTicket(null);
    } catch (err: any) {
      setError(errorMessage(err, "Impossible d'annuler le ticket"));
    }
  };

  // ------------------------------------------------------------------
  // Session management sheet: cash in/out + close with cash count.
  // ------------------------------------------------------------------
  const [sessionSheet, setSessionSheet] = useState(false);
  const [movement, setMovement] = useState({ type: 'cash_out', amount: '', reason: '' });
  const [closingCount, setClosingCount] = useState('');
  const [closedSession, setClosedSession] = useState<any>(null);
  const [busySession, setBusySession] = useState(false);

  const addMovement = async () => {
    setBusySession(true);
    setError('');
    try {
      await api.post(`/merchants/${merchantId}/cash-register/sessions/${session.id}/movements`, {
        type: movement.type,
        amount_cents: Math.round(parseFloat(movement.amount) * 100),
        reason: movement.reason || undefined,
      });
      setMovement({ type: 'cash_out', amount: '', reason: '' });
    } catch (err: any) {
      setError(errorMessage(err, 'Mouvement impossible'));
    } finally {
      setBusySession(false);
    }
  };

  const closeSession = async () => {
    setBusySession(true);
    setError('');
    try {
      const { data } = await api.post(`/merchants/${merchantId}/cash-register/sessions/${session.id}/close`, {
        closing_counted_cents: Math.round(parseFloat(closingCount || '0') * 100),
      });
      setClosedSession(data);
      queryClient.invalidateQueries({ queryKey: ['cash-session', merchantId, currency] });
    } catch (err: any) {
      setError(errorMessage(err, 'Fermeture impossible'));
    } finally {
      setBusySession(false);
    }
  };

  const canSell = !!merchantId && !!session;
  const items: any[] = ticket?.items || [];

  return (
    <div className="p-6 pb-28 md:pb-6 space-y-5 max-w-2xl mx-auto">
      <PageHeader title="Caisse" />

      {/* Store picker — only when the caller isn't already bound to one */}
      {!user?.merchant_id && merchants?.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {merchants.map((m: any) => (
            <button
              key={m.id}
              onClick={() => setPickedMerchant(m.id)}
              className={`flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-medium border ${merchantId === m.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}

      {merchantName && (
        <p className="text-sm text-muted-foreground flex items-center gap-1.5 -mt-2">
          <Store className="w-4 h-4" /> {merchantName}
        </p>
      )}

      {/* Currency — locked while a ticket is open (tickets are single-currency) */}
      <div className="flex gap-2">
        {(['CDF', 'USD'] as const).map((c) => (
          <button
            key={c}
            disabled={!!ticket}
            onClick={() => setCurrency(c)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium border disabled:opacity-50 ${ticketCurrency === c ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}
          >
            {c}
          </button>
        ))}
        <div className="flex-1" />
        {onLock && (
          <button onClick={onLock} className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
            <Lock className="w-4 h-4" /> Verrouiller
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Session gate — the till is unusable until the drawer is opened */}
      {!merchantId && !user?.merchant_id && merchants && merchants.length === 0 && (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">Aucune boutique dans cette organisation.</CardContent></Card>
      )}
      {merchantId && sessionLoading && (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      )}

      {merchantId && !sessionLoading && !session && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <DoorClosed className="w-5 h-5" /> Caisse fermée ({currency})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Ouvrez une session avec le fond de caisse avant de vendre.</p>
            <div className="space-y-2">
              <Label htmlFor="float">Fond de caisse ({currency})</Label>
              <Input
                id="float"
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={openingFloat}
                onChange={(e) => setOpeningFloat(e.target.value)}
              />
            </div>
            <Button className="w-full" onClick={openSession} disabled={opening}>
              {opening && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
              <DoorOpen className="mr-2 w-4 h-4" />
              Ouvrir la caisse
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Till */}
      {canSell && !paidTicket && (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                {ticket ? `Ticket en cours` : 'Nouvelle vente'}
              </CardTitle>
              {ticket && (
                <button onClick={() => setConfirmCancel(true)} className="text-sm font-medium text-destructive hover:underline">
                  Annuler
                </button>
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

              {items.length > 0 && (
                <div className="divide-y divide-border">
                  {items.map((item: any) => (
                    <div key={item.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground truncate">{item.product_name_snapshot}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.quantity} × {formatCurrency(item.unit_price_cents_snapshot, ticket.currency)}
                        </p>
                      </div>
                      <p className="font-semibold text-foreground flex-shrink-0">{formatCurrency(item.line_total_cents, ticket.currency)}</p>
                      <button onClick={() => removeItem(item.id)} className="text-muted-foreground hover:text-destructive flex-shrink-0">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Total + settlement */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-muted-foreground">Total</p>
                <p className="text-2xl font-bold text-foreground">
                  {formatCurrency(ticket?.total_cents || 0, ticketCurrency)}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Button onClick={payCash} disabled={!items.length || paying}>
                  {paying && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                  <Banknote className="mr-2 w-4 h-4" />
                  Espèces
                </Button>
                <Button variant="outline" onClick={payScanlinkpay} disabled={!items.length || paying}>
                  <QrCode className="mr-2 w-4 h-4" />
                  ScanLinkPay
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Session footer */}
          <Card>
            <CardContent className="pt-5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <Vault className="w-4 h-4" /> Session ouverte
                </p>
                <p className="text-xs text-muted-foreground">
                  Fond : {formatCurrency(session.opening_float_cents, session.currency)} · {formatDate(session.opened_at)}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setSessionSheet(true)}>
                Gérer
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {/* Paid ticket confirmation */}
      {paidTicket && (
        <Card>
          <CardContent className="pt-8 pb-8 text-center space-y-3">
            <CheckCircle className="w-12 h-12 text-success mx-auto" />
            <p className="text-xl font-bold text-foreground">Vente encaissée</p>
            <p className="text-2xl font-bold text-foreground">{formatCurrency(paidTicket.total_cents, paidTicket.currency)}</p>
            <Badge variant="secondary">
              {paidTicket.payment_method === 'cash' ? 'Espèces' : 'ScanLinkPay'}
            </Badge>
            <Button className="w-full mt-2" onClick={() => setPaidTicket(null)}>
              Nouvelle vente
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ScanLinkPay QR — the customer scans and pays; the ticket settles
          itself when the linked payment_request is confirmed (backend GET
          settles it, so polling the ticket is all we need). */}
      {qrRequest && (
        <ScanlinkpaySheet
          merchantId={merchantId}
          ticketId={ticket?.id}
          request={qrRequest}
          onPaid={finishPaidTicket}
          onClose={() => setQrRequest(null)}
        />
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

      {/* Session management sheet */}
      {sessionSheet && session && (
        <FormSheet onClose={() => { setSessionSheet(false); setClosedSession(null); }} title="Session de caisse">
          <div className="p-6 max-w-lg mx-auto space-y-5">
            {closedSession ? (
              <div className="space-y-4 text-center">
                <DoorClosed className="w-10 h-10 text-muted-foreground mx-auto" />
                <p className="text-lg font-bold text-foreground">Session clôturée</p>
                <div className="rounded-xl bg-secondary p-4 space-y-2 text-sm text-left">
                  <div className="flex justify-between"><span className="text-muted-foreground">Attendu en caisse</span><span className="font-semibold text-foreground">{formatCurrency(closedSession.expected_cents, closedSession.currency)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Compté</span><span className="font-semibold text-foreground">{formatCurrency(closedSession.closing_counted_cents, closedSession.currency)}</span></div>
                  <div className="flex justify-between border-t border-border pt-2">
                    <span className="text-muted-foreground">Écart</span>
                    <span className={`font-bold ${closedSession.discrepancy_cents === 0 ? 'text-success' : 'text-destructive'}`}>
                      {closedSession.discrepancy_cents > 0 ? '+' : ''}{formatCurrency(closedSession.discrepancy_cents, closedSession.currency)}
                    </span>
                  </div>
                </div>
                <Button className="w-full" onClick={() => { setSessionSheet(false); setClosedSession(null); setClosingCount(''); }}>Fermer</Button>
              </div>
            ) : (
              <>
                <div>
                  <p className="font-semibold text-foreground">Session {session.currency}</p>
                  <p className="text-sm text-muted-foreground">Fond de caisse : {formatCurrency(session.opening_float_cents, session.currency)}</p>
                </div>

                <div className="space-y-3">
                  <p className="text-sm font-semibold text-foreground">Mouvement manuel</p>
                  <Select value={movement.type} onChange={(e) => setMovement({ ...movement, type: e.target.value })}>
                    <option value="cash_in">Entrée d'espèces (+)</option>
                    <option value="cash_out">Sortie d'espèces (−)</option>
                  </Select>
                  <Input type="number" inputMode="decimal" placeholder={`Montant (${session.currency})`} value={movement.amount} onChange={(e) => setMovement({ ...movement, amount: e.target.value })} />
                  <Input placeholder="Motif (optionnel)" value={movement.reason} onChange={(e) => setMovement({ ...movement, reason: e.target.value })} />
                  <Button variant="outline" className="w-full" disabled={!movement.amount || busySession} onClick={addMovement}>
                    {busySession && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                    Enregistrer le mouvement
                  </Button>
                </div>

                <div className="border-t border-border pt-4 space-y-3">
                  <p className="text-sm font-semibold text-foreground">Fermer la caisse</p>
                  <div className="space-y-2">
                    <Label htmlFor="closing">Montant compté dans le tiroir ({session.currency})</Label>
                    <Input id="closing" type="number" inputMode="decimal" placeholder="0" value={closingCount} onChange={(e) => setClosingCount(e.target.value)} />
                  </div>
                  <Button variant="destructive" className="w-full" disabled={closingCount === '' || busySession} onClick={closeSession}>
                    <DoorClosed className="mr-2 w-4 h-4" />
                    Clôturer la session
                  </Button>
                </div>
              </>
            )}
          </div>
        </FormSheet>
      )}
    </div>
  );
}

/** QR sheet + ticket polling — the customer pays from their own phone and
 * the backend marks the ticket paid (deducting stock) as soon as the linked
 * payment_request is confirmed PAID. */
function ScanlinkpaySheet({
  merchantId,
  ticketId,
  request,
  onPaid,
  onClose,
}: {
  merchantId: string;
  ticketId: string;
  request: any;
  onPaid: (ticket: any) => void;
  onClose: () => void;
}) {
  const { data } = useQuery({
    queryKey: ['pos-ticket', ticketId],
    queryFn: async () => (await api.get(`/merchants/${merchantId}/pos/tickets/${ticketId}`)).data,
    enabled: !!ticketId,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (data?.status === 'paid') onPaid(data);
  }, [data?.status]);

  return (
    <FormSheet onClose={onClose} title="Paiement ScanLinkPay">
      <div className="p-6 max-w-lg mx-auto text-center space-y-4">
        <p className="font-semibold text-foreground">Le client paie ce ticket via ScanLinkPay</p>
        <PaymentRequestShareCard request={request} />
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          {data?.status === 'paid' ? (
            <><CheckCircle className="w-4 h-4 text-success" /> Paiement confirmé</>
          ) : (
            <><Loader2 className="w-4 h-4 animate-spin" /> En attente du paiement…</>
          )}
        </div>
      </div>
    </FormSheet>
  );
}
