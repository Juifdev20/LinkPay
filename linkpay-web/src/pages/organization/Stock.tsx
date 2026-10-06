import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/PageHeader';
import { formatCurrency, cn } from '@/lib/utils';
import { Plus, PackagePlus, AlertTriangle, Boxes, KeyRound, Loader2, ChevronRight, X } from 'lucide-react';
import { STOCK_CATEGORIES, getCategoryIcon } from '@/lib/stock-categories';
import { StockItemFormSheet, emptyStockItemForm, type StockItemFormValues } from '@/components/stock/StockItemFormSheet';
import { StockItemDetailDialog } from '@/components/stock/StockItemDetailDialog';
import { StockPasswordDialog } from '@/components/stock/StockPasswordDialog';
import { StockPasswordResetDialog } from '@/components/stock/StockPasswordResetDialog';

export default function StockPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  // Vendeur sees the stock read-only (what can be sold, what is low); the
  // backend enforces the same rule on every write endpoint.
  const canManage = user?.role !== 'vendeur';
  const [storeFilter, setStoreFilter] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [detailItem, setDetailItem] = useState<any | null>(null);
  const [formState, setFormState] = useState<{ initial: StockItemFormValues; itemId?: string; stockPassword?: string } | null>(null);
  const [pendingAction, setPendingAction] = useState<{ type: 'edit' | 'delete'; item: any } | null>(null);
  const [showResetPassword, setShowResetPassword] = useState(false);

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
  let scopedItems = storeFilter ? (items || []).filter((i: any) => i.merchant_id === storeFilter) : (items || []);
  if (categoryFilter) scopedItems = scopedItems.filter((i: any) => i.category === categoryFilter);

  const totalItems = scopedItems.length;
  const totalUnits = scopedItems.reduce((sum: number, i: any) => sum + (i.quantity || 0), 0);
  const lowStockItems = scopedItems.filter((i: any) => i.quantity <= i.low_stock_threshold);

  const visibleItems = lowStockOnly ? lowStockItems : scopedItems;

  const openCreateForm = () => {
    const effectiveMerchantId = merchants?.length === 1 ? merchants[0].id : '';
    setFormState({ initial: { ...emptyStockItemForm, merchant_id: effectiveMerchantId } });
  };

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
        condition: item.condition || '',
        warranty_months: item.warranty_months != null ? String(item.warranty_months) : '',
        attributes: item.attributes || {},
        description: item.description || '',
        quantity: String(item.quantity ?? ''),
        unit_price: item.unit_price_cents != null ? String(item.unit_price_cents / 100) : '',
        currency: item.currency || 'CDF',
        low_stock_threshold: item.low_stock_threshold != null ? String(item.low_stock_threshold) : '5',
        image_url: item.image_url || '',
      },
    });
  };

  const handlePasswordUnlocked = (password: string) => {
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

        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setCategoryFilter(null)}
            className={cn('flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-medium border', !categoryFilter ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground')}
          >
            Toutes catégories
          </button>
          {STOCK_CATEGORIES.map((c) => (
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

        {lowStockOnly && (
          <div className="flex items-center gap-2 rounded-xl bg-destructive/5 border border-destructive/20 px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-destructive flex-shrink-0" />
            <p className="text-sm text-destructive flex-1">Affichage : articles en stock bas uniquement — à réapprovisionner.</p>
            <button onClick={() => setLowStockOnly(false)} className="text-destructive hover:text-destructive/80 flex-shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {user?.role === 'enterprise' && org?.id && (
          <button
            onClick={() => setShowResetPassword(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <KeyRound className="w-3.5 h-3.5" />
            Réinitialiser le mot de passe de gestion de stock
          </button>
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {visibleItems.map((item: any) => {
              const CategoryIcon = getCategoryIcon(item.category);
              const lowStock = item.quantity <= item.low_stock_threshold;
              return (
                <div
                  key={item.id}
                  className="rounded-2xl border border-border bg-card overflow-hidden hover:shadow-card-hover hover:border-primary/30 transition-all"
                >
                  <div className="aspect-square bg-secondary flex items-center justify-center relative overflow-hidden">
                    {item.image_url ? (
                      <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                      <CategoryIcon className="w-10 h-10 text-muted-foreground" />
                    )}
                    {lowStock && (
                      <span className="absolute top-2 right-2">
                        <Badge variant="error">Stock bas</Badge>
                      </span>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="font-semibold text-foreground text-sm truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[item.brand, item.model].filter(Boolean).join(' ') || (item.item_type || '—')}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-sm font-semibold text-foreground">{formatCurrency(item.unit_price_cents, item.currency)}</span>
                      <span className="text-xs text-muted-foreground">{item.quantity} u.</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setDetailItem(item)}
                      className="flex items-center justify-center gap-1 w-full mt-3 pt-2 border-t border-border text-xs font-semibold text-primary hover:underline"
                    >
                      Voir plus d'informations
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {detailItem && (
        <StockItemDetailDialog
          item={detailItem}
          orgId={org.id}
          onClose={() => setDetailItem(null)}
          onEdit={(item) => setPendingAction({ type: 'edit', item })}
          onDelete={(item) => setPendingAction({ type: 'delete', item })}
        />
      )}

      {formState && merchants && (
        <StockItemFormSheet
          orgId={org.id}
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

      {showResetPassword && org?.id && (
        <StockPasswordResetDialog orgId={org.id} open onClose={() => setShowResetPassword(false)} />
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
