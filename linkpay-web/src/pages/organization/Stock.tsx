import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { cn } from '@/lib/utils';
import { Plus, PackagePlus, AlertTriangle, Boxes, Loader2, X, Search } from 'lucide-react';
import { ProductTable } from '@/components/stock/ProductTable';
import { StockItemFormSheet, emptyStockItemForm, type StockItemFormValues } from '@/components/stock/StockItemFormSheet';
import { StockItemDetailDialog } from '@/components/stock/StockItemDetailDialog';
import { StockPasswordDialog } from '@/components/stock/StockPasswordDialog';
import { rememberStockPassword } from '@/lib/stock-password-prompt';

export default function StockPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  // Vendeur sees the stock read-only (what can be sold, what is low); the
  // backend enforces the same rule on every write endpoint.
  const canManage = user?.role !== 'vendeur';
  const [storeFilter, setStoreFilter] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [detailItem, setDetailItem] = useState<any | null>(null);
  const [formState, setFormState] = useState<{ initial: StockItemFormValues; itemId?: string; stockPassword?: string } | null>(null);
  const [pendingAction, setPendingAction] = useState<{ type: 'edit' | 'delete'; item: any } | null>(null);

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
  });

  const { data: merchants, isFetched: merchantsFetched } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data,
    enabled: !!org?.id,
  });

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
  // request. lowStockOnly is a separate, further narrowing applied only to
  // the grid below (triggered from the "Stock bas" card itself), so the
  // stat cards keep showing the real totals for the current store/category
  // scope even while that narrower view is active.
  const scopedItems = storeFilter ? (items || []).filter((i: any) => i.merchant_id === storeFilter) : (items || []);

  const totalItems = scopedItems.length;
  const totalUnits = scopedItems.reduce((sum: number, i: any) => sum + (i.quantity || 0), 0);
  const lowStockItems = scopedItems.filter((i: any) => i.quantity <= i.low_stock_threshold);

  const visibleItems = lowStockOnly ? lowStockItems : scopedItems;

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
    setFormState({ initial: { ...emptyStockItemForm, merchant_id: merchantId, barcode } });
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
        currency: item.currency || 'CDF',
        low_stock_threshold: item.low_stock_threshold != null ? String(item.low_stock_threshold) : '5',
      },
    });
  };

  const handlePasswordUnlocked = (password: string) => {
    rememberStockPassword(password); // adding stock right after doesn't ask again for a few minutes
    if (!pendingAction) return;
    const { type, item } = pendingAction;
    setPendingAction(null);
    if (type === 'edit') {
      openEditForm(item, password);
    } else {
      deleteMutation.mutate({ item, stockPassword: password });
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Fixed while the rest of the page scrolls underneath — top-20 on
          mobile clears DashboardLayout's fixed TopBar, top-0 on desktop
          stacks right below its own sticky header (same convention as
          OnboardingWizard.tsx). */}
      <div className="sticky top-20 md:top-0 z-10 bg-background px-6 pt-6 pb-4 space-y-4">
        <PageHeader
          title="Stock & Approvisionnement"
          action={canManage ? { label: 'Ajouter', icon: Plus, onClick: openCreateForm } : undefined}
        />

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-border bg-card px-2 py-2 flex items-center gap-1.5">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Boxes className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground leading-tight">{totalItems}</p>
              <p className="text-[10px] leading-tight text-muted-foreground">Articles</p>
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card px-2 py-2 flex items-center gap-1.5">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <PackagePlus className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground leading-tight">{totalUnits}</p>
              <p className="text-[10px] leading-tight text-muted-foreground">En stock</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLowStockOnly((v) => !v)}
            className={cn(
              'rounded-xl border px-2 py-2 flex items-center gap-1.5 text-left transition-colors',
              lowStockOnly ? 'border-destructive bg-destructive/5' : 'border-border bg-card hover:border-destructive/30',
            )}
          >
            <div className="w-7 h-7 rounded-lg bg-destructive/10 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground leading-tight">{lowStockItems.length}</p>
              <p className="text-[10px] leading-tight text-muted-foreground">Stock bas</p>
            </div>
          </button>
        </div>

        {merchants?.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setStoreFilter(null)}
              className={cn('flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-medium border', !storeFilter ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground')}
            >
              Toutes les boutiques
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

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9 h-11"
            placeholder="Rechercher un produit, un code-barres…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {lowStockOnly && (
          <div className="flex items-center gap-2 rounded-xl bg-destructive/5 border border-destructive/20 px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />
            <p className="text-sm text-destructive flex-1">Affichage : articles en stock bas uniquement — à réapprovisionner.</p>
            <button onClick={() => setLowStockOnly(false)} className="text-destructive hover:text-destructive/80 flex-shrink-0">
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
          <p className="text-muted-foreground text-center py-12">Crée d'abord une boutique pour pouvoir y ajouter du stock.</p>
        ) : !visibleItems.length ? (
          <p className="text-muted-foreground text-center py-12">
            {lowStockOnly ? 'Aucun article en stock bas dans cette sélection.' : 'Aucun article pour le moment.'}
          </p>
        ) : (
          <ProductTable
            items={visibleItems}
            query={query}
            onSelect={setDetailItem}
            showStore={(merchants?.length ?? 0) > 1 && !storeFilter}
            sortStorageKey="stock-table-sort"
          />
        )}
      </div>

      {detailItem && (
        <StockItemDetailDialog
          item={detailItem}
          orgId={org.id}
          sector={org.sector}
          onClose={() => setDetailItem(null)}
          onEdit={(item) => setPendingAction({ type: 'edit', item })}
          onDelete={(item) => setPendingAction({ type: 'delete', item })}
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
