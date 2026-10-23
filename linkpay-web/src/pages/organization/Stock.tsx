import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/PageHeader';
import { cn } from '@/lib/utils';
import { Plus, PackagePlus, AlertTriangle, Boxes, PackageX, Loader2, X, Search } from 'lucide-react';
import { ProductTable } from '@/components/stock/ProductTable';
import { StockItemFormSheet, emptyStockItemForm, type StockItemFormValues } from '@/components/stock/StockItemFormSheet';
import { StockItemDetailDialog } from '@/components/stock/StockItemDetailDialog';
import { StockPasswordDialog } from '@/components/stock/StockPasswordDialog';
import { rememberStockPassword } from '@/lib/stock-password-prompt';
import { getCategoryLabel } from '@/lib/stock-categories';

export default function StockPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  // Vendeur sees the stock read-only (what can be sold, what is low); the
  // backend enforces the same rule on every write endpoint.
  const canManage = !['vendeur', 'caissier'].includes(user?.role || '');

  const [storeFilter, setStoreFilter] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [detailItem, setDetailItem] = useState<any | null>(null);
  const [formState, setFormState] = useState<{ initial: StockItemFormValues; itemId?: string; stockPassword?: string } | null>(null);
  const [pendingAction, setPendingAction] = useState<{ type: 'edit' | 'delete'; item: any } | null>(null);

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
  });

  const { data: merchants, isFetched: merchantsFetched, isLoading: merchantsLoading } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data,
    enabled: !!org?.id,
  });

  // A magasinier or a gérant is always scoped to their own station; only admins and
  // patrons (enterprise role, no merchant_id) can see all stations.
  // Fallback to merchants[0].id because station_id may not be in the session cache.
  const lockedMerchantId: string | null = user?.role === 'magasinier' || user?.role === 'gerant'
    ? (user?.station_id ?? user?.merchant_id ?? (merchants as any[])?.[0]?.id ?? null)
    : null;

  // Sync storeFilter once lockedMerchantId resolves from the merchants query.
  useEffect(() => {
    if (lockedMerchantId) setStoreFilter(lockedMerchantId);
  }, [lockedMerchantId]);

  const { data: items } = useQuery({
    queryKey: ['org-stock-items', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/stock-items`)).data,
    enabled: !!org?.id,
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ item, stockPassword }: { item: any; stockPassword: string }) =>
      api.delete(`/merchants/${item.merchant_id}/stock-items/${item.id}`, { data: { stock_password: stockPassword } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-stock-items', org.id] });
      setDetailItem(null);
    },
    onError: (err: any) => {
      // Wrong/expired password — reopen the prompt instead of failing silently.
      setPendingAction({ type: 'delete', item: deleteMutation.variables!.item });
      void err;
    },
  });

  // Store + category define the scope the top stat cards summarize — both
  // react live to a single click, per the "tableau de bord dynamique"
  // request. statusFilter is a separate, further narrowing applied only to
  // the grid below, so the stat cards keep showing the real totals for the
  // current store/category scope even while that narrower view is active.
  const scopedItems: any[] = storeFilter ? (items || []).filter((i: any) => i.merchant_id === storeFilter) : (items || []);

  const totalItems = scopedItems.length;
  const totalUnits = scopedItems.reduce((sum: number, i: any) => sum + (i.quantity || 0), 0);
  const disponibleItems = scopedItems.filter((i: any) => i.quantity > (i.low_stock_threshold ?? 5));
  const lowStockItems = scopedItems.filter((i: any) => i.quantity > 0 && i.quantity <= (i.low_stock_threshold ?? 5));
  const ruptureItems = scopedItems.filter((i: any) => i.quantity === 0);

  // Category options derived from the current store scope
  const categories = useMemo(
    () => [...new Set(scopedItems.map((i: any) => i.category).filter(Boolean))].sort((a, b) => getCategoryLabel(a).localeCompare(getCategoryLabel(b))) as string[],
    [scopedItems],
  );

  const visibleItems = useMemo(() => {
    let result = scopedItems;
    if (categoryFilter) result = result.filter((i: any) => i.category === categoryFilter);
    if (statusFilter === 'disponible') result = result.filter((i: any) => i.quantity > (i.low_stock_threshold ?? 5));
    if (statusFilter === 'bas') result = result.filter((i: any) => i.quantity > 0 && i.quantity <= (i.low_stock_threshold ?? 5));
    if (statusFilter === 'rupture') result = result.filter((i: any) => i.quantity === 0);
    return result;
  }, [scopedItems, categoryFilter, statusFilter]);

  const hasActiveFilter = !!categoryFilter || !!statusFilter;

  const openCreateForm = () => {
    const effectiveMerchantId = merchants?.length === 1 ? merchants[0].id : '';
    setFormState({ initial: { ...emptyStockItemForm, merchant_id: effectiveMerchantId } });
  };

  // Arriving from the till with an unknown scanned code
  // (?nouveau=<barcode>&boutique=<id>): open the creation form with the
  // code already filled in, so the product is registered in one go.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    // ?ajouter=1 — the home screen's "Produit" quick action: same form, no code.
    const barcode = searchParams.get('nouveau') || '';
    if ((!barcode && !searchParams.get('ajouter')) || !merchants) return;
    const boutique = searchParams.get('boutique') || '';
    const merchantId = merchants.some((m: any) => m.id === boutique)
      ? boutique
      : merchants.length === 1 ? merchants[0].id : '';
    // ?devise=USD — the till's currency when the product is added from there.
    const currency = searchParams.get('devise') === 'USD' ? 'USD' : emptyStockItemForm.currency;
    setFormState({ initial: { ...emptyStockItemForm, merchant_id: merchantId, barcode, currency } });
    setSearchParams({}, { replace: true });
  }, [searchParams, merchants]);

  const openEditForm = (item: any, stockPassword: string) => {
    setDetailItem(null);
    setFormState({
      itemId: item.id,
      stockPassword,
      initial: {
        merchant_id: item.merchant_id,
        category: item.category || '',
        item_type: item.item_type || '',
        name: item.name || '',
        brand: item.brand || '',
        model: item.model || '',
        serial_number: item.serial_number || '',
        barcode: item.barcode || '',
        condition: item.condition || '',
        warranty_months: item.warranty_months != null ? String(item.warranty_months) : '',
        attributes: item.attributes || {},
        description: item.description || '',
        quantity: String(item.quantity ?? ''),
        unit_price: item.unit_price_cents != null ? String(item.unit_price_cents / 100) : '',
        cost_price: item.cost_price_cents != null ? String(item.cost_price_cents / 100) : '',
        currency: item.currency || 'CDF',
        low_stock_threshold: item.low_stock_threshold != null ? String(item.low_stock_threshold) : '5',
        supplier_id: item.supplier_id || '',
        // Shown as such in the sheet even when the supplier was taken off the list.
        supplier_name: item.supplier_name || '',
      },
    });
  };

  const runAction = (action: { type: 'edit' | 'delete'; item: any }, password: string) => {
    if (action.type === 'edit') {
      openEditForm(action.item, password);
    } else {
      deleteMutation.mutate({ item: action.item, stockPassword: password });
    }
  };

  // The stock password is only asked when the owner switched it on (off by default).
  const requestAction = (action: { type: 'edit' | 'delete'; item: any }) => {
    if (org?.stock_password_required) setPendingAction(action);
    else runAction(action, '');
  };

  const handlePasswordUnlocked = (password: string) => {
    rememberStockPassword(password); // adding stock right after doesn't ask again for a few minutes
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    runAction(action, password);
  };

  const resetFilters = () => {
    setCategoryFilter('');
    setStatusFilter('');
  };

  // Block render for magasinier until their station is resolved.
  if (user?.role === 'magasinier' && merchantsLoading && !lockedMerchantId) {
    return (
      <div className="flex justify-center items-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Fixed while the rest of the page scrolls underneath — top-20 on
          mobile clears DashboardLayout's fixed TopBar, top-0 on desktop
          stacks right below its own sticky header (same convention as
          OnboardingWizard.tsx). */}
      <div className="sticky top-20 md:top-0 z-10 bg-background px-6 pt-4 pb-3 space-y-3">
        <PageHeader
          title="Articles et stocks"
          action={canManage ? { label: 'Nouvel article', icon: Plus, onClick: openCreateForm } : undefined}
        />

        {/* 4 KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-xl border border-border bg-card px-3 py-2 flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Boxes className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground leading-tight">{totalItems}</p>
              <p className="text-[10px] leading-tight text-muted-foreground">Total articles</p>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card px-3 py-2 flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0">
              <PackagePlus className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground leading-tight">{disponibleItems.length}</p>
              <p className="text-[10px] leading-tight text-muted-foreground">
                Stock dispo {totalItems > 0 && <span className="opacity-70">· {Math.round((disponibleItems.length / totalItems) * 100)}%</span>}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setStatusFilter((v) => v === 'bas' ? '' : 'bas')}
            className={cn(
              'rounded-xl border px-3 py-2 flex items-center gap-2 text-left transition-colors',
              statusFilter === 'bas' ? 'border-warning bg-warning/5' : 'border-border bg-card hover:border-warning/30',
            )}
          >
            <div className="w-7 h-7 rounded-lg bg-warning/10 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-3.5 h-3.5 text-warning" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground leading-tight">{lowStockItems.length}</p>
              <p className="text-[10px] leading-tight text-muted-foreground">
                Stock faible {totalItems > 0 && <span className="opacity-70">· {Math.round((lowStockItems.length / totalItems) * 100)}%</span>}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter((v) => v === 'rupture' ? '' : 'rupture')}
            className={cn(
              'rounded-xl border px-3 py-2 flex items-center gap-2 text-left transition-colors',
              statusFilter === 'rupture' ? 'border-destructive bg-destructive/5' : 'border-border bg-card hover:border-destructive/30',
            )}
          >
            <div className="w-7 h-7 rounded-lg bg-destructive/10 flex items-center justify-center flex-shrink-0">
              <PackageX className="w-3.5 h-3.5 text-destructive" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground leading-tight">{ruptureItems.length}</p>
              <p className="text-[10px] leading-tight text-muted-foreground">
                Ruptures {totalItems > 0 && <span className="opacity-70">· {Math.round((ruptureItems.length / totalItems) * 100)}%</span>}
              </p>
            </div>
          </button>
        </div>

        {/* Station name for magasinier (no filter tabs — scoped to their station only) */}
        {lockedMerchantId && (merchants as any[])?.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Station : <span className="font-medium text-foreground">
              {(merchants as any[]).find((m: any) => m.id === lockedMerchantId)?.name ?? '…'}
            </span>
          </p>
        )}

        {/* Store tabs — only for admins/patrons who can see all stations. */}
        {!lockedMerchantId && merchants?.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setStoreFilter(null)}
              className={cn('flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-medium border', !storeFilter ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground')}
            >
              Toutes les stations
            </button>
            {merchants.map((m: any) => (
              <button
                key={m.id}
                onClick={() => setStoreFilter(m.id)}
                className={cn('flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-medium border', storeFilter === m.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground')}
              >
                {m.name}
              </button>
            ))}
          </div>
        )}

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9 h-9"
            placeholder="Rechercher un article, un code-barres…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* Category + status filters on the same row */}
        <div className="flex gap-2">
          {categories.length > 0 && (
            <Select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Catégorie"
              className="h-9 flex-1"
            >
              <option value="">Toutes les catégories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{getCategoryLabel(c)}</option>
              ))}
            </Select>
          )}
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Statut"
            className="h-9 flex-1"
          >
            <option value="">Tous les statuts</option>
            <option value="disponible">Disponible</option>
            <option value="bas">Stock faible</option>
            <option value="rupture">Rupture</option>
          </Select>
          {hasActiveFilter && (
            <button
              onClick={resetFilters}
              className="h-9 px-3 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 flex items-center gap-1 transition-colors flex-shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Active filter banner */}
        {statusFilter === 'bas' && (
          <div className="flex items-center gap-2 rounded-xl bg-warning/5 border border-warning/20 px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0" />
            <p className="text-sm text-warning flex-1">Articles en stock faible — à réapprovisionner.</p>
            <button onClick={() => setStatusFilter('')} className="text-warning hover:text-warning/80 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {statusFilter === 'rupture' && (
          <div className="flex items-center gap-2 rounded-xl bg-destructive/5 border border-destructive/20 px-3 py-2">
            <PackageX className="w-4 h-4 text-destructive flex-shrink-0" />
            <p className="text-sm text-destructive flex-1">Articles en rupture de stock (quantité = 0).</p>
            <button onClick={() => setStatusFilter('')} className="text-destructive hover:text-destructive/80 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      <div className="px-6 pb-6 space-y-4">
        {!merchantsFetched ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !merchants?.length ? (
          <p className="text-muted-foreground text-center py-12">Créez d'abord une station pour pouvoir y ajouter du stock.</p>
        ) : !visibleItems.length ? (
          <p className="text-muted-foreground text-center py-12">
            {hasActiveFilter || query.trim() ? 'Aucun article ne correspond à cette sélection.' : 'Aucun article pour le moment.'}
          </p>
        ) : (
          <ProductTable
            items={visibleItems}
            query={query}
            onSelect={setDetailItem}
            showStore={(merchants?.length ?? 0) > 1 && !storeFilter}
            sortStorageKey="stock-table-sort"
            stockManagerMode
            showPurchase={canManage}
            className="max-h-[calc(100dvh-272px)] md:max-h-none"
          />
        )}

        {/* Summary line */}
        {visibleItems.length > 0 && (
          <p className="text-xs text-muted-foreground text-center">
            {visibleItems.length} article{visibleItems.length > 1 ? 's' : ''} · {totalUnits} unité{totalUnits > 1 ? 's' : ''} en stock
          </p>
        )}
      </div>

      {detailItem && (
        <StockItemDetailDialog
          item={detailItem}
          orgId={org.id}
          sector={org.sector}
          onClose={() => setDetailItem(null)}
          onEdit={(item) => requestAction({ type: 'edit', item })}
          onDelete={(item) => requestAction({ type: 'delete', item })}
        />
      )}

      {formState && merchants && (
        <StockItemFormSheet
          orgId={org.id}
          sector={org.sector}
          merchants={merchants}
          initial={formState.initial}
          itemId={formState.itemId}
          stockPassword={formState.stockPassword}
          onClose={() => setFormState(null)}
          onSaved={() => setFormState(null)}
        />
      )}

      {pendingAction && org?.id && (
        <StockPasswordDialog
          orgId={org.id}
          open
          onClose={() => setPendingAction(null)}
          onUnlocked={handlePasswordUnlocked}
        />
      )}

      {deleteMutation.isPending && (
        <div className="fixed inset-0 z-[70] bg-black/30 flex items-center justify-center">
          <div className="bg-card rounded-2xl p-6 flex items-center gap-3 shadow-lg">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <span className="text-sm font-medium text-foreground">Suppression...</span>
          </div>
        </div>
      )}
    </div>
  );
}
