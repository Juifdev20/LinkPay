import { useEffect, useRef, useState } from 'react';
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
import { ProductTable } from '@/components/stock/ProductTable';
import { posErrorMessage } from './PosPage';
import { formatCurrency } from '@/lib/utils';
import { Search, Trash2, PauseCircle, Loader2, ShieldAlert, Minus, Plus, ScanBarcode, X, ShoppingCart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BarcodeScannerView } from '@/components/BarcodeScannerView';
import { beepError, beepOk, listenForScannerBursts } from '@/lib/barcode';

const STAFF_ROLES = ['magasinier', 'vendeur', 'caissier', 'comptable'];

/**
 * The selling screen itself. Desktop (lg+) is a real till: product catalog
 * with rayon chips on the left, ticket (lines, steppers, HT/TVA/TTC, pay)
 * sticky on the right — everything reachable without scrolling. Mobile keeps
 * the single-column search-first flow. Same product merges, lines are
 * voided — not deleted — with an authorization PIN for staff.
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
  // Same roles as the stock write endpoints (StockService STOCK_STAFF_ROLES).
  const canCreateProducts = ['enterprise', 'magasinier'].includes(user?.role || '');
  const navigate = useNavigate();
  const [error, setError] = useState('');

  // Latest ticket for async callbacks — a queued add must never act on the
  // stale ticket captured by the render that scheduled it.
  const ticketRef = useRef<any>(ticket);
  useEffect(() => { ticketRef.current = ticket; }, [ticket]);

  // Counts failed syncs, so "Encaisser" can tell whether the flush it waited
  // on actually succeeded before opening the payment.
  const syncFailures = useRef(0);

  // Ticket creation is single-flight: rapid adds before the first ticket
  // exists must all land on the SAME ticket, never spawn several. The tap
  // that creates it also sends its product, so the first line costs ONE
  // request (create + add) instead of two in a row.
  const creatingTicket = useRef<Promise<any> | null>(null);
  const createTicket = (firstItemId: string) => {
    creatingTicket.current = api
      .post(`/merchants/${merchantId}/pos/tickets`, { currency, first_stock_item_id: firstItemId })
      .then(({ data }) => {
        localStorage.setItem(ticketKey, data.id);
        ticketRef.current = data;
        setTicket(data);
        return data;
      })
      .finally(() => {
        creatingTicket.current = null;
      });
    return creatingTicket.current;
  };

  // Adds of different products run in parallel, so their responses can land
  // out of order — never let an older snapshot of the ticket overwrite a
  // newer one (the server stamps updated_at on every line change).
  const applyServerTicket = (data: any) => {
    const cur = ticketRef.current;
    if (cur?.id === data.id && cur.updated_at && data.updated_at && data.updated_at < cur.updated_at) return;
    ticketRef.current = data;
    setTicket(data);
  };

  // Last known TVA rate of this store — lets the totals show correctly on
  // the very first tap, before the ticket (which carries the rate) exists.
  const tvaKey = `pos-tva:${merchantId}`;
  useEffect(() => {
    const rate = ticket?.merchant?.pos_tva_rate_pct;
    if (rate != null) try { localStorage.setItem(tvaKey, String(rate)); } catch { /* ignore */ }
  }, [ticket?.merchant?.pos_tva_rate_pct, tvaKey]);

  // ------------------------------------------------------------------
  // Product lookup: live name search, Enter = barcode (USB scanners type
  // the code then send Enter — same handler serves both). The search box
  // keeps/regains focus after every add so a scanner-driven cashier never
  // needs to touch the mouse.
  // ------------------------------------------------------------------
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  // Keep the search box focused only with a mouse (PC till): on a phone or
  // tablet, focusing it pops the on-screen keyboard over half the till after
  // every tap. Hand-held scanners don't need the focus anyway — they're
  // caught anywhere on the till (listenForScannerBursts).
  const focusSearch = () => {
    if (window.matchMedia?.('(pointer: fine)').matches) searchRef.current?.focus();
  };

  const ticketCurrency = ticket?.currency || currency;

  // Full catalog of the store, loaded once — the product table, the search
  // and barcode lookups all work on it in memory (no request per keystroke).
  const { data: catalog, isLoading: catalogLoading } = useQuery({
    queryKey: ['pos-catalog', merchantId],
    queryFn: async () => (await api.get(`/merchants/${merchantId}/stock-items`)).data,
    enabled: !!merchantId,
  });
  const catalogItems: any[] = (catalog || []).filter((i: any) => i.currency === ticketCurrency);

  // ------------------------------------------------------------------
  // Cart quantities — ONE mechanism for a tap on a product, "+" and "−".
  // The cashier's wanted quantity per product (desired) is shown at once;
  // nothing on screen ever waits for the network or gets disabled. In the
  // background, one request per product at a time (serialized, so two
  // "does the line exist?" checks never race) brings the server to that
  // quantity: create the ticket with it, add the line, or PATCH the line.
  // Taps made while a request is in flight are folded into the next one.
  // ------------------------------------------------------------------
  const desired = useRef<Record<string, { qty: number; item: any }>>({});
  const syncQueues = useRef<Record<string, Promise<void>>>({});
  const syncScheduled = useRef<Record<string, boolean>>({});
  const [, bumpCart] = useState(0);
  const bump = () => bumpCart((n) => n + 1);

  const serverLine = (stockItemId: string) =>
    (ticketRef.current?.items || []).find((i: any) => i.stock_item_id === stockItemId && i.status === 'active');
  const wantedQty = (stockItemId: string) =>
    desired.current[stockItemId]?.qty ?? serverLine(stockItemId)?.quantity ?? 0;

  const resync = () => {
    const tid = localStorage.getItem(ticketKey);
    if (!tid) return;
    api.get(`/merchants/${merchantId}/pos/tickets/${tid}`)
      .then(({ data }) => { ticketRef.current = data; setTicket(data); })
      .catch(() => {});
  };

  const syncProduct = async (pid: string) => {
    const want = desired.current[pid];
    if (!want) return;
    const settled = () => { if (desired.current[pid] === want) delete desired.current[pid]; };
    try {
      // No await before createTicket(): a second product tapped in the same
      // instant must find creatingTicket already set and wait for it.
      if (ticketRef.current?.status !== 'open') {
        if (creatingTicket.current) {
          await creatingTicket.current;
        } else {
          if (want.qty <= 0) return settled();
          const data = await createTicket(pid); // ticket + this line at qty 1
          if (data.first_item_error) throw new Error(data.first_item_error);
        }
      }
      const t = ticketRef.current;
      const line = serverLine(pid);
      const current = line?.quantity ?? 0;
      if (want.qty === current) return settled();

      let data: any;
      if (line && want.qty >= 1) {
        data = (await api.patch(`/merchants/${merchantId}/pos/tickets/${t.id}/items/${line.id}`, { quantity: want.qty })).data;
      } else if (!line && want.qty >= 1) {
        data = (await api.post(`/merchants/${merchantId}/pos/tickets/${t.id}/items`, { stock_item_id: pid, quantity: want.qty })).data;
      } else {
        // 0 on a line the server already has goes through the authorized void.
        return settled();
      }
      applyServerTicket(data);
      settled();
    } catch (err: any) {
      syncFailures.current += 1;
      setError(err?.response ? posErrorMessage(err, 'Quantité impossible') : err?.message || 'Quantité impossible');
      delete desired.current[pid];
      resync(); // a refused quantity must not linger on screen
    } finally {
      bump();
    }
  };

  const scheduleSync = (pid: string) => {
    if (syncScheduled.current[pid]) return; // a pass is already waiting — it will read the latest value
    syncScheduled.current[pid] = true;
    syncQueues.current[pid] = (syncQueues.current[pid] || Promise.resolve())
      .then(() => {
        syncScheduled.current[pid] = false;
        return syncProduct(pid);
      })
      .catch(() => {});
  };

  /** Sets the quantity of a product in the cart — instant on screen. */
  const changeQty = (item: { id: string; name: string; unit_price_cents: number }, qty: number) => {
    setError('');
    desired.current[item.id] = { qty: Math.max(0, qty), item };
    bump();
    scheduleSync(item.id);
  };

  const addProduct = (item: any) => {
    changeQty(item, wantedQty(item.id) + 1);
    setQuery('');
    focusSearch();
  };

  /** Ticket line → the product shape changeQty works with. */
  const productOf = (line: any) => ({
    id: line.stock_item_id,
    name: line.product_name_snapshot,
    unit_price_cents: line.unit_price_cents_snapshot,
  });

  /** Forget unsent quantities — the ticket they belonged to is gone. */
  const resetCart = () => {
    desired.current = {};
    bump();
  };

  // ------------------------------------------------------------------
  // Barcode scanning — hand-held scanner (types the code + Enter, caught
  // anywhere on the till) or the camera. The code is looked up in the
  // catalog already in memory first: a known product is added with no
  // network wait at all; the API is only asked for codes not in it.
  // ------------------------------------------------------------------
  const [cameraOpen, setCameraOpen] = useState(false);
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<{ name: string; count: number } | null>(null);

  const handleScan = async (raw: string, opts: { manual?: boolean } = {}) => {
    const code = raw.trim();
    if (!code) return;
    setQuery('');
    setUnknownCode(null);

    let item = (catalog || []).find((i: any) => i.barcode === code);
    if (!item) {
      try {
        item = (await api.get(`/merchants/${merchantId}/stock-items/by-barcode/${encodeURIComponent(code)}`)).data;
      } catch {
        item = null;
      }
    }
    if (!item) {
      // Typed text + Enter that isn't a code is just a name search.
      if (opts.manual) return;
      beepError();
      setUnknownCode(code);
      return;
    }
    if (item.currency !== ticketCurrency) {
      beepError();
      setError(`« ${item.name} » est vendu en ${item.currency}, ce ticket est en ${ticketCurrency}.`);
      return;
    }
    if (item.quantity <= 0) {
      beepError();
      setError(`« ${item.name} » est en rupture de stock.`);
      return;
    }
    beepOk();
    addProduct(item);
    setLastScan((s) => ({ name: item.name, count: (s?.count ?? 0) + 1 }));
  };

  // Latest handler for the long-lived keyboard listener below.
  const handleScanRef = useRef(handleScan);
  handleScanRef.current = handleScan;
  const scannerPaused = useRef(false);
  useEffect(
    () => listenForScannerBursts((code) => { if (!scannerPaused.current) handleScanRef.current(code); }),
    [],
  );

  // ------------------------------------------------------------------
  // Ticket panel height: on desktop it must show its totals + Encaisser
  // WITHOUT any page scroll, whatever the window height or whatever sits
  // above it (header, banners, tabs). So instead of a fixed vh cap we
  // measure the space actually left under the card's top edge and update
  // it on scroll (the card sticks at top:16 once the page scrolls, which
  // legitimately gives it more room) and on resize.
  // ------------------------------------------------------------------
  const ticketCardRef = useRef<HTMLDivElement>(null);
  const [ticketMaxH, setTicketMaxH] = useState<number | null>(null);

  useEffect(() => {
    const el = ticketCardRef.current;
    const scroller = el?.closest('main');
    const update = () => {
      if (!el || window.innerWidth < 1024) {
        setTicketMaxH(null); // mobile: natural flow, no cap
        return;
      }
      setTicketMaxH(Math.max(320, window.innerHeight - el.getBoundingClientRect().top - 16));
    };
    update();
    window.addEventListener('resize', update);
    scroller?.addEventListener('scroll', update, { passive: true });
    return () => {
      window.removeEventListener('resize', update);
      scroller?.removeEventListener('scroll', update);
    };
  }, []);

  /** Waits until the server has every quantity the cashier set (usually
   *  already the case). True if it all went through. */
  const flushPending = async () => {
    const before = syncFailures.current;
    for (let pass = 0; pass < 10 && Object.keys(desired.current).length; pass++) {
      await Promise.all(Object.values(syncQueues.current));
    }
    return syncFailures.current === before && !Object.keys(desired.current).length;
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
  // Hold (with an optional note) / cancel / payment.
  // ------------------------------------------------------------------
  const [paymentOpen, setPaymentOpen] = useState(false);
  // Mobile: ticket detail sheet, opened from the fixed cart bar.
  const [ticketSheetOpen, setTicketSheetOpen] = useState(false);
  // "Encaisser" is clickable the moment a product is on screen; the click
  // finishes any sync still in flight (usually already done) then opens
  // the payment on the server-confirmed ticket.
  const [preparingPayment, setPreparingPayment] = useState(false);
  const openPayment = async () => {
    setPreparingPayment(true);
    try {
      const ok = await flushPending();
      if (ok && ticketRef.current?.status === 'open') {
        setTicketSheetOpen(false);
        setPaymentOpen(true);
      }
    } finally {
      setPreparingPayment(false);
    }
  };
  const [paidTicket, setPaidTicket] = useState<any>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdNote, setHoldNote] = useState('');
  const [holding, setHolding] = useState(false);

  const holdTicket = async () => {
    setHolding(true);
    setError('');
    try {
      await api.post(`/merchants/${merchantId}/pos/tickets/${ticket.id}/hold`, {
        note: holdNote || undefined,
      });
      setHoldOpen(false);
      setHoldNote('');
      resetCart();
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
      resetCart();
      clearTicket();
    } catch (err: any) {
      setError(posErrorMessage(err, "Impossible d'annuler le ticket"));
    }
  };

  const finishPaidTicket = (t: any) => {
    resetCart();
    clearTicket();
    setPaidTicket(t);
    setPaymentOpen(false);
    queryClient.invalidateQueries({ queryKey: ['pos-catalog', merchantId] });
    queryClient.invalidateQueries({ queryKey: ['pos-sales', merchantId] });
  };

  // The hand-held scanner must not add items behind an open sheet (payment,
  // hold, void, camera) — e.g. while the cashier types the cash received.
  scannerPaused.current = paymentOpen || holdOpen || !!voidTarget || cameraOpen || !!paidTicket;

  const items: any[] = ticket?.items || [];
  const voidedItems = items.filter((i) => i.status === 'voided');
  const tvaRate = Number(ticket?.merchant?.pos_tva_rate_pct ?? (() => {
    try { return localStorage.getItem(tvaKey) ?? 0; } catch { return 0; }
  })());

  // Displayed lines = server lines with the cashier's wanted quantities
  // applied, plus products not on the server yet. Totals follow instantly.
  const wanted = desired.current;
  const anyPending = Object.keys(wanted).length > 0;
  const activeItems = items
    .filter((i) => i.status !== 'voided')
    .map((i) => {
      const w = wanted[i.stock_item_id];
      return w ? { ...i, quantity: w.qty, line_total_cents: i.unit_price_cents_snapshot * w.qty } : i;
    })
    .filter((i) => i.quantity > 0)
    .concat(
      Object.values(wanted)
        .filter((w) => w.qty > 0 && !items.some((i) => i.stock_item_id === w.item.id && i.status !== 'voided'))
        .map((w) => ({
          id: `pending-${w.item.id}`,
          stock_item_id: w.item.id,
          unsynced: true,
          status: 'active',
          product_name_snapshot: w.item.name,
          quantity: w.qty,
          unit_price_cents_snapshot: w.item.unit_price_cents,
          line_total_cents: w.item.unit_price_cents * w.qty,
        })),
    );

  // Units in the cart, overall and per product (grid badges).
  const cartCount = activeItems.reduce((n: number, i: any) => n + i.quantity, 0);
  const inCart: Record<string, number> = {};
  for (const i of activeItems) if (i.stock_item_id) inCart[i.stock_item_id] = (inCart[i.stock_item_id] || 0) + i.quantity;

  // The mobile ticket sheet has nothing left to show once the cart is empty
  // (ticket cancelled, last line voided) — close it.
  useEffect(() => {
    if (ticketSheetOpen && !activeItems.length) setTicketSheetOpen(false);
  }, [ticketSheetOpen, activeItems.length]);

  // Voiding asks for a reason/PIN in its own sheet — close the ticket sheet
  // first so two sheets never stack.
  const askVoid = (item: any) => {
    setTicketSheetOpen(false);
    setVoidTarget(item);
  };

  // While adds are in flight the server totals lag behind — recompute
  // display totals client-side at the same TTC-extraction rule.
  const shownTotal = anyPending ? activeItems.reduce((s, i) => s + i.line_total_cents, 0) : ticket?.total_cents || 0;
  const shownTva = anyPending
    ? tvaRate > 0 ? Math.round(shownTotal - shownTotal / (1 + tvaRate / 100)) : 0
    : ticket?.tva_cents || 0;
  const shownHt = shownTotal - shownTva;

  // Ticket lines + totals + Encaisser — shared by the desktop ticket column
  // and the mobile ticket sheet (opened from the cart bar).
  const renderTicketBody = () => (
    <>
      {activeItems.length > 0 && (
        <div className="divide-y divide-border max-h-[40vh] lg:max-h-none lg:flex-1 lg:min-h-0 overflow-y-auto -mx-1 px-1">
          {activeItems.map((item: any) => (
            <div key={item.id} className="flex items-center gap-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground truncate">{item.product_name_snapshot}</p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(item.unit_price_cents_snapshot, ticket?.currency || ticketCurrency)} / u
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => (item.quantity <= 1 && !item.unsynced ? askVoid(item) : changeQty(productOf(item), item.quantity - 1))}
                  className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30"
                  title={item.quantity <= 1 ? 'Annuler la ligne' : 'Réduire'}
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="w-7 text-center text-sm font-semibold text-foreground">
                  {item.quantity}
                </span>
                <button
                  onClick={() => changeQty(productOf(item), item.quantity + 1)}
                  className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30"
                  title="Augmenter"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="font-semibold flex-shrink-0 min-w-[4.5rem] whitespace-nowrap text-right text-foreground">
                {formatCurrency(item.line_total_cents, ticket?.currency || ticketCurrency)}
              </p>
              <button
                // Not on the server yet → just drop it; else the authorized void.
                onClick={() => (item.unsynced ? changeQty(productOf(item), 0) : askVoid(item))}
                className="text-muted-foreground hover:text-destructive flex-shrink-0 disabled:opacity-30"
                title="Annuler la ligne"
              >
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

      {/* Totals HT / TVA / TTC + pay — always in view on desktop. Shown
          from the first tap, before the server has even created the
          ticket (pending lines carry the optimistic totals). */}
      {(ticket || activeItems.length > 0) && (
        <div className="border-t border-border pt-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <p className="text-muted-foreground">Sous-total HT</p>
            <p className="font-medium text-foreground">{formatCurrency(shownHt, ticketCurrency)}</p>
          </div>
          <div className="flex items-center justify-between text-sm">
            <p className="text-muted-foreground">TVA ({tvaRate}%)</p>
            <p className="font-medium text-foreground">{formatCurrency(shownTva, ticketCurrency)}</p>
          </div>
          <div className="flex items-center justify-between pt-1">
            <p className="text-muted-foreground">Total TTC</p>
            <p className="text-2xl font-bold text-foreground">{formatCurrency(shownTotal, ticketCurrency)}</p>
          </div>
          <Button className="w-full mt-1" size="lg" onClick={openPayment} disabled={!activeItems.length || preparingPayment}>
            {preparingPayment && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
            Encaisser
          </Button>
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="lg:grid lg:grid-cols-[1fr_400px] lg:gap-6 lg:items-start space-y-5 lg:space-y-0">
        {/* ============================== Catalog ============================== */}
        <div className="space-y-4 min-w-0">
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                ref={searchRef}
                className="pl-9 h-11 text-base"
                placeholder="Rechercher un produit ou scanner un code-barres…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleScan(query, { manual: true })}
                autoFocus={window.matchMedia?.('(pointer: fine)').matches}
              />
            </div>
            <Button
              variant="outline"
              className="h-11 flex-shrink-0"
              onClick={() => { setLastScan(null); setCameraOpen(true); }}
              title="Scanner avec la caméra"
            >
              <ScanBarcode className="w-5 h-5 sm:mr-2" />
              <span className="hidden sm:inline">Scanner</span>
            </Button>
          </div>

          {/* Unknown code — say it loudly, and let the people who manage the
              stock register the product right away with the code filled in. */}
          {unknownCode && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 flex items-center gap-3">
              <p className="flex-1 min-w-0 text-sm text-destructive">
                Code <span className="font-mono font-semibold">{unknownCode}</span> inconnu dans cette boutique.
              </p>
              {canCreateProducts && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/dashboard/organization/stock?nouveau=${encodeURIComponent(unknownCode)}&boutique=${merchantId}`)}
                >
                  Créer le produit
                </Button>
              )}
              <button onClick={() => setUnknownCode(null)} className="text-destructive/70 hover:text-destructive" aria-label="Fermer">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Catalog as a table — search filters it instantly (no network),
              headers sort, the aisle bar narrows it; a tap adds to the cart. */}
          {catalogLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : catalogItems.length ? (
            <ProductTable
              items={catalogItems}
              query={query}
              onSelect={addProduct}
              cartQty={inCart}
              disableOutOfStock
              sortStorageKey="pos-table-sort"
              scrollClassName="lg:max-h-[calc(100vh-300px)]"
            />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">
              Aucun produit en {ticketCurrency} dans cette boutique — ajoutez-en depuis la page Stock.
            </p>
          )}
        </div>

        {/* ============================== Ticket ============================== */}
        {/* On desktop the card is sticky and capped to the space actually
            left below it: lines scroll internally while the totals +
            Encaisser stay pinned at the bottom — no page scroll needed. */}
        <Card
          ref={ticketCardRef}
          style={ticketMaxH ? { maxHeight: ticketMaxH } : undefined}
          className="hidden lg:flex lg:sticky lg:top-4 lg:flex-col lg:max-h-[calc(100vh-2rem)]"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              {ticket ? `Ticket #${ticket.ticket_number ?? '—'}` : 'Nouvelle vente'}
            </CardTitle>
            {ticket && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setHoldOpen(true)}
                  disabled={!activeItems.length}
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
          <CardContent className="space-y-3 lg:flex lg:flex-col lg:flex-1 lg:min-h-0">
            {!activeItems.length && !voidedItems.length && (
              <p className="text-sm text-muted-foreground text-center py-6">
                Scannez un code-barres ou touchez un produit pour démarrer la vente.
              </p>
            )}
            {renderTicketBody()}
          </CardContent>
        </Card>
      </div>

      {/* ===================== Mobile / tablet cart ===================== */}
      {/* Spacer so the fixed cart bar never hides the last product row. */}
      {activeItems.length > 0 && <div className="h-24 lg:hidden" aria-hidden />}

      {activeItems.length > 0 && (
        <div className="lg:hidden fixed left-0 right-0 z-40 bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0 px-3 pb-5 md:pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          <div
            role="button"
            tabIndex={0}
            onClick={() => setTicketSheetOpen(true)}
            onKeyDown={(e) => e.key === 'Enter' && setTicketSheetOpen(true)}
            className="max-w-2xl mx-auto flex items-center gap-3 rounded-2xl bg-card border border-border shadow-lg pl-4 pr-2 py-2"
          >
            <div className="relative flex-shrink-0">
              <ShoppingCart className="w-6 h-6 text-primary" />
              <span className="absolute -top-2 -right-2 min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                {cartCount}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground leading-tight">
                {cartCount} article{cartCount > 1 ? 's' : ''} · voir le ticket
              </p>
              <p className="text-lg font-bold text-foreground leading-tight truncate">{formatCurrency(shownTotal, ticketCurrency)}</p>
            </div>
            <Button
              size="lg"
              className="flex-shrink-0"
              onClick={(e) => { e.stopPropagation(); openPayment(); }}
              disabled={preparingPayment}
            >
              {preparingPayment && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
              Encaisser
            </Button>
          </div>
        </div>
      )}

      {/* Ticket detail — opened from the cart bar */}
      {ticketSheetOpen && (
        <FormSheet onClose={() => setTicketSheetOpen(false)} title="Ticket en cours">
          <div className="p-4 pb-6 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-foreground">
                {ticket ? `Ticket #${ticket.ticket_number ?? '—'}` : 'Nouvelle vente'}
              </h2>
              {ticket && (
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => { setTicketSheetOpen(false); setHoldOpen(true); }}
                    disabled={!activeItems.length}
                    className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    <PauseCircle className="w-4 h-4" /> Attente
                  </button>
                  <button
                    onClick={() => { setTicketSheetOpen(false); setConfirmCancel(true); }}
                    className="text-sm font-medium text-destructive hover:underline"
                  >
                    Annuler
                  </button>
                </div>
              )}
            </div>
            {renderTicketBody()}
          </div>
        </FormSheet>
      )}


      {/* Camera scanning — stays open, item after item, until "Terminer" */}
      {cameraOpen && (
        <BarcodeScannerView
          title="Scanner les articles"
          continuous
          onDetected={(code) => handleScan(code)}
          onClose={() => { setCameraOpen(false); focusSearch(); }}
          status={
            unknownCode ? (
              <span className="text-red-300">Code {unknownCode} inconnu</span>
            ) : error ? (
              <span className="text-red-300">{error}</span>
            ) : lastScan ? (
              <span>
                <span className="font-semibold">{lastScan.name}</span> ajouté
                <span className="text-white/70"> · {lastScan.count} article{lastScan.count > 1 ? 's' : ''} scanné{lastScan.count > 1 ? 's' : ''} · Total {formatCurrency(shownTotal, ticketCurrency)}</span>
              </span>
            ) : undefined
          }
        />
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

      {/* Hold sheet — optional note so the next cashier knows why it's parked */}
      {holdOpen && (
        <FormSheet onClose={() => setHoldOpen(false)} title="Mettre en attente">
          <div className="p-6 max-w-lg mx-auto space-y-4">
            <div className="flex items-center gap-2">
              <PauseCircle className="w-5 h-5 text-primary" />
              <p className="font-semibold text-foreground">Mettre le ticket en attente ?</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Il sera récupérable depuis l'onglet « En attente » — pratique quand le client revient plus tard.
            </p>
            <div className="space-y-2">
              <Label htmlFor="hold-note">Note (optionnel)</Label>
              <Input
                id="hold-note"
                placeholder="Ex : cliente partie chercher sa carte"
                value={holdNote}
                onChange={(e) => setHoldNote(e.target.value)}
              />
            </div>
            <Button className="w-full" disabled={holding} onClick={holdTicket}>
              {holding && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
              Mettre en attente
            </Button>
          </div>
        </FormSheet>
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
              {voidTarget.quantity} × {voidTarget.product_name_snapshot} — {formatCurrency(voidTarget.line_total_cents, ticket?.currency || ticketCurrency)}
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
