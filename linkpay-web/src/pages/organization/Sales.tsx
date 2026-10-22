import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { SaleInvoice } from '@/components/sales/SaleInvoice';
import { SaleReceipt } from '@/components/sales/SaleReceipt';
import { SalePaymentSheet } from '@/components/sales/SalePaymentSheet';
import { ProductTable } from '@/components/stock/ProductTable';
import { BarcodeScannerView } from '@/components/BarcodeScannerView';
import { PosOfflinePaymentSheet } from '@/pages/pos/PosOfflinePayment';
import api from '@/lib/api';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { PageHeader } from '@/components/PageHeader';
import { StationChips } from '@/components/StationChips';
import { useStationScope, resolveStation } from '@/lib/station-scope';
import { useAuthStore } from '@/lib/auth-store';
import { FormSheet } from '@/components/FormSheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/utils';
import { Search, ShoppingCart, Plus, Minus, Trash2, Loader2, BarChart3, ListOrdered, ScanBarcode, X, WifiOff, Clock } from 'lucide-react';
import { beepError, beepOk, listenForScannerBursts } from '@/lib/barcode';
import { isNetworkError, useNetwork, useOnline } from '@/lib/network';
import { enqueue, newClientRef } from '@/lib/outbox';
import type { OrgOfflineSalePayload } from '@/lib/outbox-handlers';

/**
 * The Ventes module (electronics shops) — the same screen as the supermarket till (PosTill): the catalog as a table
 * (no photos) with search, barcode and IMEI lookup on the left, the sale's ticket sticky on the right (a cart bar
 * and a sheet on a phone), then "Encaisser" → cash or ScanLinkPay → the thermal ticket, with the A4 invoice for the
 * warranty when the customer wants one. Without network the sale is paid in cash and recorded on the server later.
 * One sale = one currency and one station (its stock, its cash).
 */
export default function SalesPage() {
  const queryClient = useQueryClient();
  const online = useOnline();
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [ticketSheetOpen, setTicketSheetOpen] = useState(false);

  // The sale being paid (on the server), the offline payment, the ticket and the A4 invoice.
  const [activeSaleId, setActiveSaleId] = useState<string | null>(null);
  const [payError, setPayError] = useState('');
  const [offlinePayOpen, setOfflinePayOpen] = useState(false);
  const [receiptSale, setReceiptSale] = useState<any>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const receivedRef = useRef(0);

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
  });

  const { data: items, isLoading } = useQuery({
    queryKey: ['org-stock-items', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/stock-items`)).data,
    enabled: !!org?.id,
  });
  const allItems: any[] = items || [];
  const byId = useMemo(() => new Map(allItems.map((i) => [i.id, i])), [allItems]);

  // The owner picks « Toutes les stations » or one station (the choice is shared with the home dashboard);
  // an employee only ever gets their own station's articles from the API.
  const user = useAuthStore((st) => st.user);
  const isOwner = user?.role === 'enterprise' || !!user?.acting_as_org_id;
  const scope = useStationScope();
  const { data: merchants } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data,
    enabled: !!org?.id && isOwner,
  });
  const stationId = isOwner ? resolveStation(scope.stationId, merchants) : null;
  const catalog: any[] = useMemo(() => (stationId ? allItems.filter((i) => i.merchant_id === stationId) : allItems), [allItems, stationId]);
  const multiStation = useMemo(() => new Set(catalog.map((i) => i.merchant_id)).size > 1, [catalog]);
  const stationName = (merchantId?: string) => allItems.find((i) => i.merchant_id === merchantId)?.merchant_name || null;

  const { data: sale } = useQuery({
    queryKey: ['org-sale', org?.id, activeSaleId],
    queryFn: async () => (await api.get(`/organizations/${org.id}/sales/${activeSaleId}`)).data,
    enabled: !!org?.id && !!activeSaleId,
    // A ScanLinkPay payment settles the sale on the server: realtime below, and this as a safety net.
    refetchInterval: 4000,
  });
  useRealtimeInvalidate(
    'sales',
    org?.id ? `organization_id=eq.${org.id}` : undefined,
    [['org-sale', org?.id, activeSaleId]],
    !!org?.id && !!activeSaleId,
  );

  const refreshAfterSale = () => {
    queryClient.invalidateQueries({ queryKey: ['org-stock-items', org?.id] });
    queryClient.invalidateQueries({ queryKey: ['org-sales-stats', org?.id] });
  };

  // Paid by ScanLinkPay (or by cash on another screen): straight to the ticket. Its QR expired unpaid (15 minutes,
  // cancelled by the server): say so, and offer to relaunch the same sale in one tap.
  const [expiredSale, setExpiredSale] = useState<any>(null);
  useEffect(() => {
    if (!activeSaleId || sale?.id !== activeSaleId || sale.status === 'PENDING') return;
    setActiveSaleId(null);
    if (sale.status === 'PAID') {
      setReceiptSale(sale);
      refreshAfterSale();
    } else if (sale.status === 'CANCELLED' && sale.qr_expires_at && new Date(sale.qr_expires_at).getTime() <= Date.now()) {
      setExpiredSale(sale);
    }
  }, [sale?.id, sale?.status, activeSaleId]);

  // The payment window closed while the customer was still paying (or about to): the sale is kept in a strip above the
  // catalog — « Reprendre » reopens it, and if the customer pays meanwhile the strip says so and shows the ticket.
  const [parkedSaleId, setParkedSaleId] = useState<string | null>(null);
  const { data: parkedSale } = useQuery({
    queryKey: ['org-sale', org?.id, parkedSaleId],
    queryFn: async () => (await api.get(`/organizations/${org.id}/sales/${parkedSaleId}`)).data,
    enabled: !!org?.id && !!parkedSaleId,
    refetchInterval: 5000,
  });
  useEffect(() => {
    if (parkedSale?.id === parkedSaleId && parkedSale?.status === 'CANCELLED') setParkedSaleId(null);
    if (parkedSale?.id === parkedSaleId && parkedSale?.status === 'PAID') refreshAfterSale();
  }, [parkedSale?.status]);

  /** The same articles back on a new sale (new QR, new 15 minutes); the stock is checked again by the server. */
  const relaunchSale = () => {
    const again: Record<string, number> = {};
    for (const line of expiredSale?.sale_items || []) {
      if (line.stock_item_id) again[line.stock_item_id] = (again[line.stock_item_id] || 0) + line.quantity;
    }
    setExpiredSale(null);
    setCart(again);
    createSale.mutate(Object.entries(again).map(([stock_item_id, quantity]) => ({ stock_item_id, quantity })));
  };

  // ------------------------------------------------------------------ cart
  const lines = Object.entries(cart)
    .map(([id, qty]) => ({ item: byId.get(id), qty }))
    .filter((l): l is { item: any; qty: number } => !!l.item && l.qty > 0);
  const cartCount = lines.reduce((n, l) => n + l.qty, 0);
  const cartCurrency: string = lines[0]?.item.currency || 'CDF';
  const cartStation: string | undefined = lines[0]?.item.merchant_id;
  const total = lines.reduce((n, l) => n + l.item.unit_price_cents * l.qty, 0);
  const inCart = cart;

  const changeQty = (item: any, qty: number) => {
    setError('');
    const next = Math.max(0, Math.min(qty, item.quantity ?? 0));
    if (qty > (item.quantity ?? 0)) setError(`Stock insuffisant pour « ${item.name} » : il reste ${item.quantity ?? 0} unité(s).`);
    setCart((c) => {
      const copy = { ...c };
      if (next === 0) delete copy[item.id];
      else copy[item.id] = next;
      return copy;
    });
  };

  /** A tap on a product (or a scan): one more on the sale, if it can go on it. */
  const addProduct = (item: any): boolean => {
    if ((item.quantity ?? 0) <= 0) { setError(`« ${item.name} » est en rupture de stock.`); return false; }
    if (lines.length && item.currency !== cartCurrency) {
      setError(`Une vente ne contient qu'une devise : « ${item.name} » est en ${item.currency}, la vente en ${cartCurrency}.`);
      return false;
    }
    if (lines.length && item.merchant_id !== cartStation) {
      setError(`Une vente ne concerne qu'une station : « ${item.name} » est à ${item.merchant_name || 'une autre station'}.`);
      return false;
    }
    changeQty(item, (cart[item.id] || 0) + 1);
    return (cart[item.id] || 0) < (item.quantity ?? 0);
  };

  const resetCart = () => { setCart({}); setError(''); setTicketSheetOpen(false); };

  // A barcode or an IMEI / serial number: scanner (anywhere on the screen), camera, or typed + Enter.
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const handleScan = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    setQuery('');
    setUnknownCode(null);
    const lower = code.toLowerCase();
    const item = catalog.find((i) => i.barcode === code || (i.serial_number && String(i.serial_number).toLowerCase() === lower));
    if (!item) { setUnknownCode(code); beepError(); return; }
    if (addProduct(item)) { beepOk(); setLastScan(item.name); } else beepError();
  };
  const handleScanRef = useRef(handleScan);
  handleScanRef.current = handleScan;
  const scannerPaused = useRef(false);
  scannerPaused.current = !!activeSaleId || offlinePayOpen || !!receiptSale || invoiceOpen;
  useEffect(() => listenForScannerBursts((code) => { if (!scannerPaused.current) handleScanRef.current(code); }), []);

  // ------------------------------------------------------------------ selling
  /** Offline: the sale is paid in cash now, its ticket prints at once, and it reaches the server when it can. */
  const sellOffline = (receivedCents: number) => {
    const clientRef = newClientRef();
    const payload: OrgOfflineSalePayload = {
      org_id: org.id,
      sold_at: new Date().toISOString(),
      items: lines.map(({ item, qty }) => ({ stock_item_id: item.id, quantity: qty, unit_price_cents: item.unit_price_cents, name: item.name })),
    };
    enqueue('sales.offline', `Vente en espèces · ${formatCurrency(total, cartCurrency)}`, payload, `${cartCount} article${cartCount > 1 ? 's' : ''}`, clientRef);
    // The stock shown on this device follows its own offline sales until the server answers.
    queryClient.setQueryData(['org-stock-items', org.id], (old: any) =>
      Array.isArray(old) ? old.map((it: any) => (cart[it.id] ? { ...it, quantity: Math.max(0, it.quantity - cart[it.id]) } : it)) : old,
    );
    setReceiptSale({
      offline: true,
      reference: `SALE-HL-${clientRef.replace(/-/g, '').slice(0, 16).toUpperCase()}`,
      status: 'PAID',
      payment_method: 'cash',
      merchant_id: cartStation,
      currency: cartCurrency,
      total_cents: total,
      received_cents: receivedCents,
      created_at: payload.sold_at,
      sale_items: lines.map(({ item, qty }) => ({
        name: item.name,
        category: item.category,
        quantity: qty,
        unit_price_cents: item.unit_price_cents,
        details: { brand: item.brand, model: item.model, condition: item.condition, serial_number: item.serial_number, warranty_months: item.warranty_months, attributes: item.attributes },
      })),
    });
    setOfflinePayOpen(false);
    resetCart();
  };

  const errorMessage = (err: any) => {
    const m = err?.response?.data?.message;
    return (Array.isArray(m) ? m.join(' ') : m) || 'Une erreur est survenue, réessayez.';
  };

  const createSale = useMutation({
    networkMode: 'always',
    mutationFn: async (items?: { stock_item_id: string; quantity: number }[]) => {
      if (!useNetwork.getState().online) return 'offline' as const;
      try {
        return (await api.post(`/organizations/${org.id}/sales`, {
          items: items ?? lines.map(({ item, qty }) => ({ stock_item_id: item.id, quantity: qty })),
        })).data;
      } catch (err) {
        if (isNetworkError(err)) return 'offline' as const;
        throw err;
      }
    },
    onSuccess: (data) => {
      if (data === 'offline') { setOfflinePayOpen(true); return; }
      setPayError('');
      setActiveSaleId(data.sale.id);
      resetCart();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const openPayment = () => {
    setError('');
    if (!lines.length || createSale.isPending) return;
    createSale.mutate(undefined);
  };

  const [busy, setBusy] = useState<'cash' | 'cancel' | null>(null);
  const payCash = async (receivedCents: number) => {
    if (!sale) return;
    receivedRef.current = receivedCents;
    setBusy('cash');
    setPayError('');
    const paidHere = (offline: boolean) => {
      setActiveSaleId(null);
      setReceiptSale({ ...sale, status: 'PAID', payment_method: 'cash', received_cents: receivedCents, offline });
      refreshAfterSale();
    };
    try {
      if (!useNetwork.getState().online) throw Object.assign(new Error('offline'), { offline: true });
      await api.post(`/organizations/${org.id}/sales/${sale.id}/cash`);
      paidHere(false);
    } catch (err: any) {
      if (err?.offline || isNetworkError(err)) {
        // The sale exists on the server: only the cash collection waits for the network.
        enqueue('sales.cash', `Encaissement espèces · ${sale.reference}`, { org_id: org.id, sale_id: sale.id }, formatCurrency(sale.total_cents, sale.currency));
        paidHere(true);
      } else {
        setPayError(errorMessage(err));
        // Expired meanwhile: the refreshed sale (cancelled) opens the "relaunch" sheet.
        queryClient.invalidateQueries({ queryKey: ['org-sale', org.id, sale.id] });
      }
    } finally {
      setBusy(null);
    }
  };

  const cancelSale = async () => {
    if (!sale) return;
    setBusy('cancel');
    setPayError('');
    try {
      await api.post(`/organizations/${org.id}/sales/${sale.id}/cancel`);
      setActiveSaleId(null);
    } catch (err) {
      setPayError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  // ------------------------------------------------------------------ ticket
  const renderTicketBody = () => (
    <>
      {lines.length > 0 && (
        <div className="divide-y divide-border max-h-[40vh] lg:max-h-none lg:flex-1 lg:min-h-0 overflow-y-auto -mx-1 px-1">
          {lines.map(({ item, qty }) => (
            <div key={item.id} className="flex items-center gap-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground truncate">{item.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {formatCurrency(item.unit_price_cents, item.currency)} / u
                  {item.serial_number ? ` · IMEI ${item.serial_number}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => changeQty(item, qty - 1)}
                  className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent"
                  title="Réduire"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="w-7 text-center text-sm font-semibold text-foreground">{qty}</span>
                <button
                  onClick={() => changeQty(item, qty + 1)}
                  disabled={qty >= (item.quantity ?? 0)}
                  className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30"
                  title="Augmenter"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="font-semibold flex-shrink-0 min-w-[4.5rem] whitespace-nowrap text-right text-foreground">
                {formatCurrency(item.unit_price_cents * qty, item.currency)}
              </p>
              <button onClick={() => changeQty(item, 0)} className="text-muted-foreground hover:text-destructive flex-shrink-0" title="Retirer la ligne">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {lines.length > 0 && (
        <div className="border-t border-border pt-3 space-y-2">
          {multiStation && cartStation && (
            <p className="text-xs text-muted-foreground">Station : {stationName(cartStation)}</p>
          )}
          <div className="flex items-center justify-between pt-1">
            <p className="text-muted-foreground">Total</p>
            <p className="text-2xl font-bold text-foreground">{formatCurrency(total, cartCurrency)}</p>
          </div>
          <Button className="w-full mt-1" size="lg" onClick={openPayment} disabled={createSale.isPending}>
            {createSale.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
            Encaisser
          </Button>
        </div>
      )}
    </>
  );

  return (
    <div className="px-4 pt-4 pb-28 md:pb-6 lg:p-6 space-y-4 lg:space-y-5 max-w-2xl lg:max-w-7xl mx-auto">
      <PageHeader title="Ventes" />
      <div className="min-w-0 overflow-x-auto pb-1 -mt-2">
        <div className="flex w-max items-center gap-2">
          <Link
            to="/dashboard/organization/sales/history"
            className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary/10 transition-colors"
          >
            <ListOrdered className="w-4 h-4" />
            Toutes les ventes
          </Link>
          <Link
            to="/dashboard/organization/sales/dashboard"
            className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary/10 transition-colors"
          >
            <BarChart3 className="w-4 h-4" />
            Tableau de bord
          </Link>
        </div>
      </div>

      {!online && (
        <div className="flex items-start gap-3 rounded-xl bg-slate-800 px-4 py-3 text-sm text-white dark:bg-slate-700">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
          <p><b>Ventes hors ligne.</b> Vendez normalement : paiement en espèces, ticket imprimé, et la vente part au serveur dès le retour du réseau.</p>
        </div>
      )}
      {parkedSaleId && parkedSale?.id === parkedSaleId && (parkedSale.status === 'PAID' ? (
        <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm">
          <p className="flex-1 text-foreground"><b>Vente {parkedSale.reference} payée</b> · {formatCurrency(parkedSale.total_cents, parkedSale.currency)}</p>
          <Button size="sm" className="shrink-0 rounded-lg" onClick={() => { setReceiptSale(parkedSale); setParkedSaleId(null); }}>Voir le ticket</Button>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <Clock className="h-4 w-4 shrink-0 text-warning" />
          <p className="flex-1 text-foreground"><b>Vente {parkedSale.reference} en attente de paiement</b> · {formatCurrency(parkedSale.total_cents, parkedSale.currency)}</p>
          <Button size="sm" variant="outline" className="shrink-0 rounded-lg" onClick={() => { setActiveSaleId(parkedSaleId); setParkedSaleId(null); }}>Reprendre</Button>
        </div>
      ))}
      {error && (
        <div className="flex items-start gap-3 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          <p className="flex-1">{error}</p>
          <button onClick={() => setError('')} aria-label="Fermer"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="lg:grid lg:grid-cols-[1fr_400px] lg:gap-6 lg:items-start space-y-5 lg:space-y-0">
        {/* ============================== Catalog ============================== */}
        <div className="space-y-4 min-w-0">
          {isOwner && merchants?.length > 1 && (
            <StationChips stations={merchants} value={stationId} onChange={scope.setStation} />
          )}
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-9 h-11 text-base"
                placeholder="Produit, marque, IMEI ou code-barres…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  const code = query.trim();
                  const exact = catalog.some((i) => i.barcode === code || (i.serial_number && String(i.serial_number).toLowerCase() === code.toLowerCase()));
                  if (exact) handleScan(code);
                }}
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

          {unknownCode && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 flex items-center gap-3">
              <p className="flex-1 min-w-0 text-sm text-destructive">
                Code <span className="font-mono font-semibold">{unknownCode}</span> inconnu dans le stock.
              </p>
              <button onClick={() => setUnknownCode(null)} className="text-destructive/70 hover:text-destructive" aria-label="Fermer">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : catalog.length ? (
            <ProductTable
              items={catalog}
              query={query}
              onSelect={addProduct}
              cartQty={inCart}
              disableOutOfStock
              showStore={multiStation}
              sortStorageKey="sales-table-sort"
              scrollClassName="lg:max-h-[calc(100vh-300px)]"
            />
          ) : (
            <div className="text-center py-6 space-y-3">
              <p className="text-sm text-muted-foreground">Aucun article en stock. Ajoutez vos articles dans Stock.</p>
              <Button size="sm" asChild>
                <Link to="/dashboard/organization/stock">Aller au stock</Link>
              </Button>
            </div>
          )}
        </div>

        {/* ============================== Ticket ============================== */}
        <Card className="hidden lg:flex lg:sticky lg:top-4 lg:flex-col lg:max-h-[calc(100vh-2rem)]">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">{online ? 'Nouvelle vente' : 'Vente hors ligne'}</CardTitle>
            {lines.length > 0 && (
              <button onClick={resetCart} className="text-sm font-medium text-destructive hover:underline">Vider</button>
            )}
          </CardHeader>
          <CardContent className="space-y-3 lg:flex lg:flex-col lg:flex-1 lg:min-h-0">
            {!lines.length && (
              <p className="text-sm text-muted-foreground text-center py-6">
                Scannez un code-barres ou un IMEI, ou touchez un produit pour démarrer la vente.
              </p>
            )}
            {renderTicketBody()}
          </CardContent>
        </Card>
      </div>

      {/* ===================== Mobile / tablet cart ===================== */}
      {lines.length > 0 && <div className="h-24 lg:hidden" aria-hidden />}
      {lines.length > 0 && (
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
                {cartCount} article{cartCount > 1 ? 's' : ''} · voir la vente
              </p>
              <p className="text-lg font-bold text-foreground leading-tight truncate">{formatCurrency(total, cartCurrency)}</p>
            </div>
            <Button
              size="lg"
              className="flex-shrink-0"
              onClick={(e) => { e.stopPropagation(); openPayment(); }}
              disabled={createSale.isPending}
            >
              {createSale.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
              Encaisser
            </Button>
          </div>
        </div>
      )}

      {ticketSheetOpen && (
        <FormSheet onClose={() => setTicketSheetOpen(false)} title="Vente en cours">
          <div className="p-4 pb-6 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-foreground">{online ? 'Nouvelle vente' : 'Vente hors ligne'}</h2>
              <button onClick={resetCart} className="text-sm font-medium text-destructive hover:underline">Vider</button>
            </div>
            {renderTicketBody()}
          </div>
        </FormSheet>
      )}

      {cameraOpen && (
        <BarcodeScannerView
          title="Scanner les articles"
          continuous
          onDetected={(code) => handleScan(code)}
          onClose={() => setCameraOpen(false)}
          status={
            unknownCode ? <span className="text-red-300">Code {unknownCode} inconnu</span>
              : error ? <span className="text-red-300">{error}</span>
                : lastScan ? (
                  <span>
                    <span className="font-semibold">{lastScan}</span> ajouté
                    <span className="text-white/70"> · {cartCount} article{cartCount > 1 ? 's' : ''} · Total {formatCurrency(total, cartCurrency)}</span>
                  </span>
                ) : undefined
          }
        />
      )}

      {activeSaleId && (sale?.id === activeSaleId ? (
        <SalePaymentSheet
          sale={sale}
          busy={busy}
          error={payError}
          onCash={payCash}
          onCancelSale={cancelSale}
          // Closed without paying: the sale stays « en attente » (strip above the catalog), its QR still payable.
          onClose={() => { setParkedSaleId(activeSaleId); setActiveSaleId(null); }}
        />
      ) : (
        <FormSheet onClose={() => setActiveSaleId(null)} title="Encaissement">
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        </FormSheet>
      ))}

      {expiredSale && (
        <FormSheet onClose={() => setExpiredSale(null)} title="Vente expirée">
          <div className="p-6 max-w-lg mx-auto space-y-5 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-warning/15">
              <Clock className="h-7 w-7 text-warning" />
            </div>
            <div>
              <p className="text-lg font-bold text-foreground">15 minutes sans paiement</p>
              <p className="mt-1 text-sm text-muted-foreground">
                La vente {expiredSale.reference} ({formatCurrency(expiredSale.total_cents, expiredSale.currency)}) a été annulée et son QR ne peut plus être payé. Le stock n'a pas bougé.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button size="lg" onClick={relaunchSale} disabled={createSale.isPending}>
                {createSale.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                Relancer la vente
              </Button>
              <Button variant="outline" onClick={() => setExpiredSale(null)}>Fermer</Button>
            </div>
          </div>
        </FormSheet>
      )}

      {offlinePayOpen && (
        <PosOfflinePaymentSheet
          totalCents={total}
          currency={cartCurrency}
          onConfirm={sellOffline}
          onClose={() => setOfflinePayOpen(false)}
        />
      )}

      {receiptSale && org && !invoiceOpen && (
        <SaleReceipt
          org={org}
          sale={receiptSale}
          stationName={multiStation ? stationName(receiptSale.merchant_id) : null}
          onInvoice={() => setInvoiceOpen(true)}
          onClose={() => setReceiptSale(null)}
        />
      )}
      {invoiceOpen && org && receiptSale?.sale_items && (
        <SaleInvoice org={org} sale={receiptSale} onClose={() => setInvoiceOpen(false)} />
      )}
    </div>
  );
}
