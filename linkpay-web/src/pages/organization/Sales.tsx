import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { SaleInvoice } from '@/components/sales/SaleInvoice';
import api from '@/lib/api';
import { publicOrigin } from '@/lib/share';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { PageHeader } from '@/components/PageHeader';
import { FormSheet } from '@/components/FormSheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, cn } from '@/lib/utils';
import { Link } from 'react-router-dom';
import { Search, ShoppingCart, Plus, Minus, Trash2, Package, CheckCircle2, Loader2, Banknote, BarChart3, Printer, ListOrdered } from 'lucide-react';
import { getSectorConfig, getCategoryIcon } from '@/lib/stock-categories';

type Currency = 'CDF' | 'USD';

export default function SalesPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [activeSaleId, setActiveSaleId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [invoiceOpen, setInvoiceOpen] = useState(false);

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
  });

  const { data: items, isLoading } = useQuery({
    queryKey: ['org-stock-items', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/stock-items`)).data,
    enabled: !!org?.id,
  });

  const { data: sale, error: saleError } = useQuery({
    queryKey: ['org-sale', org?.id, activeSaleId],
    queryFn: async () => (await api.get(`/organizations/${org.id}/sales/${activeSaleId}`)).data,
    enabled: !!org?.id && !!activeSaleId,
  });

  // A wallet payment settles the sale server-side (sale -> PAID, stock
  // released). Listening on `sales` lets the seller's screen flip to
  // "Vendue" the moment the client pays, without a manual refresh.
  useRealtimeInvalidate(
    'sales',
    org?.id ? `organization_id=eq.${org.id}` : undefined,
    [
      ['org-sale', org?.id, activeSaleId],
      ['org-stock-items', org?.id],
      ['org-sales-stats', org?.id],
    ],
    !!org?.id && !!activeSaleId,
  );

  useEffect(() => {
    if (!sale?.link_token) {
      setQrDataUrl('');
      return;
    }
    QRCode.toDataURL(`${publicOrigin()}/p/${sale.link_token}`, {
      width: 320,
      margin: 2,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [sale?.link_token]);

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items || []).filter((item: any) => {
      if (categoryFilter && item.category !== categoryFilter) return false;
      if (!q) return true;
      return [item.name, item.brand, item.model, item.item_type]
        .filter(Boolean)
        .some((v: string) => v.toLowerCase().includes(q));
    });
  }, [items, query, categoryFilter]);

  const cartLines = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ item: (items || []).find((i: any) => i.id === id), qty }))
        .filter((l): l is { item: any; qty: number } => !!l.item && l.qty > 0),
    [cart, items],
  );

  // Totals are kept per currency and never summed together — CDF and USD
  // are independent balances in this app (see CurrencySelector).
  const totals = useMemo(() => {
    const t: Record<Currency, number> = { CDF: 0, USD: 0 };
    cartLines.forEach(({ item, qty }) => {
      const cur = (item.currency === 'USD' ? 'USD' : 'CDF') as Currency;
      t[cur] += item.unit_price_cents * qty;
    });
    return t;
  }, [cartLines]);

  const count = cartLines.reduce((sum, l) => sum + l.qty, 0);

  const setQty = (item: any, qty: number) => {
    const clamped = Math.max(0, Math.min(qty, item.quantity));
    setCart((c) => {
      const next = { ...c };
      if (clamped === 0) delete next[item.id];
      else next[item.id] = clamped;
      return next;
    });
  };

  const clearCart = () => setCart({});

  const createSaleMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/organizations/${org.id}/sales`, {
          items: cartLines.map(({ item, qty }) => ({ stock_item_id: item.id, quantity: qty })),
        })
      ).data,
    onSuccess: (data) => {
      setActiveSaleId(data.sale.id);
      // The invoice opens straight away on the seller's screen, ready to print.
      setInvoiceOpen(true);
      clearCart();
      setCartOpen(false);
      queryClient.invalidateQueries({ queryKey: ['org-stock-items', org.id] });
    },
  });

  const cashMutation = useMutation({
    mutationFn: async () => (await api.post(`/organizations/${org.id}/sales/${activeSaleId}/cash`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-sale', org.id, activeSaleId] });
      queryClient.invalidateQueries({ queryKey: ['org-stock-items', org.id] });
      queryClient.invalidateQueries({ queryKey: ['org-sales-stats', org.id] });
    },
  });

  const errorMessage = (err: any) => err?.response?.data?.message || 'Une erreur est survenue, réessaie.';


  const CartContent = (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-foreground">Panier</h2>
        {count > 0 && (
          <button onClick={clearCart} className="text-xs font-medium text-destructive hover:underline">
            Vider
          </button>
        )}
      </div>

      {cartLines.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-10 text-muted-foreground">
          <ShoppingCart className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm">Ajoute des articles pour commencer une vente.</p>
        </div>
      ) : (
        <div className="space-y-3 overflow-y-auto">
          {cartLines.map(({ item, qty }) => {
            const Icon = getCategoryIcon(item.category);
            return (
              <div key={item.id} className="flex items-center gap-3 rounded-xl border border-border p-2.5">
                <div className="w-12 h-12 rounded-lg bg-secondary overflow-hidden flex items-center justify-center flex-shrink-0">
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                  ) : (
                    <Icon className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{formatCurrency(item.unit_price_cents, item.currency)}</p>
                </div>
                <Stepper qty={qty} max={item.quantity} onChange={(q) => setQty(item, q)} />
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-auto pt-4 border-t border-border space-y-4">
        <div className="space-y-1">
          {(['CDF', 'USD'] as Currency[])
            .filter((c) => totals[c] > 0)
            .map((c) => (
              <div key={c} className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Total {c}</span>
                <span className="text-lg font-bold text-foreground">{formatCurrency(totals[c], c)}</span>
              </div>
            ))}
          {count === 0 && <p className="text-sm text-muted-foreground text-right">0 article</p>}
        </div>

        {createSaleMutation.isError && (
          <p className="text-sm text-destructive">{errorMessage(createSaleMutation.error)}</p>
        )}

        <Button
          className="w-full py-6 text-base font-semibold rounded-xl"
          disabled={count === 0 || createSaleMutation.isPending}
          onClick={() => createSaleMutation.mutate()}
        >
          {createSaleMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
          Valider la vente
        </Button>
      </div>
    </div>
  );

  const saleIsPaid = sale?.status === 'PAID';
  const saleCurrency = (sale?.currency === 'USD' ? 'USD' : 'CDF') as Currency;

  const SaleStatus = activeSaleId && (
    <div className="rounded-2xl border border-border bg-card p-5 md:p-6 mb-6 text-center">
      {!sale ? (
        <div className="py-10">
          {saleError ? (
            <p className="text-sm text-destructive">Impossible de charger la vente.</p>
          ) : (
            <Loader2 className="w-6 h-6 mx-auto animate-spin text-primary" />
          )}
        </div>
      ) : saleIsPaid ? (
        <div className="py-4">
          <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-success" />
          </div>
          <h2 className="text-xl font-bold text-foreground">Vente encaissée</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {sale.payment_method === 'cash' ? 'Paiement en espèces' : 'Paiement ScanLinkPay reçu'} · {sale.reference}
          </p>
          <p className="text-2xl font-bold text-foreground mt-4">{formatCurrency(sale.total_cents, saleCurrency)}</p>
          <Button variant="outline" className="mt-6 w-full" onClick={() => setInvoiceOpen(true)}>
            <Printer className="mr-2 w-4 h-4" />
            Imprimer la facture
          </Button>
          <Button className="mt-3 w-full" onClick={() => setActiveSaleId(null)}>
            Nouvelle vente
          </Button>
        </div>
      ) : (
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-1">Vente en attente de paiement</p>
          <p className="text-2xl font-bold text-foreground">{formatCurrency(sale.total_cents, saleCurrency)}</p>
          <p className="text-xs text-muted-foreground mt-1">{sale.reference}</p>

          {qrDataUrl && (
            <div className="flex justify-center my-5">
              <img src={qrDataUrl} alt="QR de paiement" className="w-56 h-56 rounded-2xl border border-border" />
            </div>
          )}
          <p className="text-sm text-muted-foreground mb-5">
            Le client scanne ce QR avec ScanLinkPay et confirme avec son PIN.
          </p>

          {cashMutation.isError && <p className="text-sm text-destructive mb-3">{errorMessage(cashMutation.error)}</p>}

          <div className="flex flex-col gap-2">
            <Button className="w-full" disabled={cashMutation.isPending} onClick={() => cashMutation.mutate()}>
              {cashMutation.isPending ? <Loader2 className="mr-2 w-4 h-4 animate-spin" /> : <Banknote className="mr-2 w-4 h-4" />}
              Encaissé en espèces
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setInvoiceOpen(true)}>
              <Printer className="mr-2 w-4 h-4" />
              Imprimer la facture
            </Button>
            <Button variant="outline" className="w-full" onClick={() => setActiveSaleId(null)}>
              Retour aux ventes
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto">
      {invoiceOpen && org && sale?.sale_items && (
        <SaleInvoice org={org} sale={sale} onClose={() => setInvoiceOpen(false)} />
      )}

      {/* Title, search and category filters stay fixed while the product
          grid scrolls — same convention as the Stock module. */}
      <div className="sticky top-20 md:top-0 z-10 bg-background px-6 pt-6 pb-4 space-y-3 min-w-0">
        <PageHeader title="Ventes" />
        {/* Only this row scrolls sideways; the rest of the page stays put. */}
        <div className="min-w-0 overflow-x-auto pb-1">
          <div className="flex w-max items-center gap-2">
            <Link
              to="/dashboard/organization/sales/history"
              className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm font-semibold text-primary hover:bg-primary/10 transition-colors"
            >
              <ListOrdered className="w-4 h-4" />
              Voir toutes les ventes
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

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher un article..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setCategoryFilter(null)}
            className={cn('flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-medium border', !categoryFilter ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground')}
          >
            Tous
          </button>
          {getSectorConfig(org?.sector).categories.map((c) => (
            <button
              key={c.value}
              onClick={() => setCategoryFilter(c.value)}
              className={cn('flex-shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium border', categoryFilter === c.value ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground')}
            >
              <c.icon className="w-3.5 h-3.5" />
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 pb-40 md:pb-8 md:grid md:grid-cols-[1fr_300px] md:gap-6 md:items-start">
        <div>
          {SaleStatus}
          {!activeSaleId && (isLoading ? (
            <p className="text-muted-foreground text-center py-12">Chargement...</p>
          ) : !items?.length ? (
            <div className="text-center py-12">
              <Package className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
              <p className="text-muted-foreground">Aucun article en stock. Ajoute tes articles dans Stock & Approvisionnement.</p>
            </div>
          ) : !visibleItems.length ? (
            <p className="text-muted-foreground text-center py-12">Aucun article ne correspond à ta recherche.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
              {visibleItems.map((item: any) => {
                const inCart = cart[item.id] || 0;
                const soldOut = item.quantity <= 0;
                const Icon = getCategoryIcon(item.category);
                return (
                  <div
                    key={item.id}
                    className={cn(
                      'rounded-2xl border bg-card overflow-hidden flex flex-col transition-all',
                      inCart > 0 ? 'border-primary shadow-sm' : 'border-border',
                      soldOut && 'opacity-50',
                    )}
                  >
                    <div className="aspect-square bg-secondary flex items-center justify-center relative">
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                      ) : (
                        <Icon className="w-10 h-10 text-muted-foreground" />
                      )}
                      {soldOut ? (
                        <span className="absolute top-2 left-2"><Badge variant="error">Rupture</Badge></span>
                      ) : item.quantity <= item.low_stock_threshold ? (
                        <span className="absolute top-2 left-2"><Badge variant="warning">{item.quantity} restant{item.quantity > 1 ? 's' : ''}</Badge></span>
                      ) : null}
                    </div>
                    <div className="p-3 flex flex-col flex-1">
                      <p className="text-sm font-semibold text-foreground truncate">{item.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {[item.brand, item.model].filter(Boolean).join(' ') || item.item_type || '—'}
                      </p>
                      <p className="text-sm font-bold text-foreground mt-2">{formatCurrency(item.unit_price_cents, item.currency)}</p>
                      <div className="mt-auto pt-3">
                        {inCart > 0 ? (
                          <Stepper qty={inCart} max={item.quantity} onChange={(q) => setQty(item, q)} className="w-full justify-between" />
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full"
                            disabled={soldOut}
                            onClick={() => setQty(item, 1)}
                          >
                            <Plus className="w-4 h-4 mr-1" />
                            Ajouter
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Desktop: cart as a sticky side panel next to the grid. */}
        <aside className="hidden md:flex flex-col sticky top-24 rounded-2xl border border-border bg-card p-5 min-h-[420px] max-h-[calc(100vh-7rem)]">
          {CartContent}
        </aside>
      </div>

      {/* Mobile: compact bar above the bottom nav that opens the cart sheet. */}
      {count > 0 && !cartOpen && (
        <div className="md:hidden fixed bottom-20 left-4 right-4 z-40">
          <button
            onClick={() => setCartOpen(true)}
            className="w-full flex items-center justify-between rounded-2xl bg-primary text-primary-foreground px-4 py-3 shadow-lg shadow-primary/30"
          >
            <span className="flex items-center gap-2 font-semibold">
              <ShoppingCart className="w-5 h-5" />
              {count} article{count > 1 ? 's' : ''}
            </span>
            <span className="text-sm font-bold">
              {(['CDF', 'USD'] as Currency[]).filter((c) => totals[c] > 0).map((c) => formatCurrency(totals[c], c)).join(' · ')}
            </span>
          </button>
        </div>
      )}

      {cartOpen && (
        <FormSheet onClose={() => setCartOpen(false)} title="Panier">
          <div className="p-6 min-h-[60vh] flex flex-col">{CartContent}</div>
        </FormSheet>
      )}
    </div>
  );
}

function Stepper({
  qty,
  max,
  onChange,
  className,
}: {
  qty: number;
  max: number;
  onChange: (qty: number) => void;
  className?: string;
}) {
  return (
    <div className={cn('inline-flex items-center gap-1 rounded-xl border border-border p-0.5', className)}>
      <button
        type="button"
        onClick={() => onChange(qty - 1)}
        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-accent transition-colors"
        aria-label="Retirer"
      >
        {qty === 1 ? <Trash2 className="w-3.5 h-3.5 text-destructive" /> : <Minus className="w-3.5 h-3.5" />}
      </button>
      <span className="min-w-[2rem] text-center text-sm font-bold">{qty}</span>
      <button
        type="button"
        onClick={() => onChange(qty + 1)}
        disabled={qty >= max}
        className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-accent transition-colors disabled:opacity-40"
        aria-label="Ajouter"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
