import { useState, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/PageHeader';
import { formatCurrency } from '@/lib/utils';
import { Loader2, Plus, X, PackagePlus, AlertTriangle, Boxes } from 'lucide-react';

const CONDITIONS = [
  { value: 'neuf', label: 'Neuf' },
  { value: 'occasion', label: 'Occasion' },
  { value: 'reconditionne', label: 'Reconditionné' },
];

const MOVEMENT_TYPES = [
  { value: 'in', label: 'Réapprovisionnement (+)' },
  { value: 'out', label: 'Perte / casse (-)' },
  { value: 'adjustment', label: 'Correction' },
];

const emptyForm = {
  merchant_id: '',
  name: '',
  brand: '',
  model: '',
  serial_number: '',
  condition: '',
  warranty_months: '',
  quantity: '',
  unit_price: '',
  currency: 'CDF' as 'CDF' | 'USD',
  low_stock_threshold: '5',
};

export default function StockPage() {
  const queryClient = useQueryClient();
  const [storeFilter, setStoreFilter] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [movementItemId, setMovementItemId] = useState<string | null>(null);
  const [movement, setMovement] = useState({ type: 'in', quantity: '', reason: '' });

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
  });

  const { data: merchants } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data,
    enabled: !!org?.id,
  });

  const { data: items } = useQuery({
    queryKey: ['org-stock-items', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/stock-items`)).data,
    enabled: !!org?.id,
  });

  const { data: summary } = useQuery({
    queryKey: ['org-stock-summary', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/stock-summary`)).data,
    enabled: !!org?.id,
  });

  const isElectronics = org?.sector === 'electronique';
  const invalidateStock = () => {
    queryClient.invalidateQueries({ queryKey: ['org-stock-items', org.id] });
    queryClient.invalidateQueries({ queryKey: ['org-stock-summary', org.id] });
  };

  // The store picker only renders when there's more than one boutique (see
  // JSX below) — with exactly one, form.merchant_id is never set by the
  // user, so fall back to it automatically here rather than leaving the
  // create button silently broken for the common single-store case.
  const effectiveMerchantId = form.merchant_id || (merchants?.length === 1 ? merchants[0].id : '');

  const createMutation = useMutation({
    mutationFn: async () =>
      (await api.post(`/merchants/${effectiveMerchantId}/stock-items`, {
        name: form.name,
        brand: form.brand || undefined,
        model: form.model || undefined,
        serial_number: form.serial_number || undefined,
        condition: form.condition || undefined,
        warranty_months: form.warranty_months ? Number(form.warranty_months) : undefined,
        quantity: form.quantity ? Number(form.quantity) : 0,
        unit_price_cents: form.unit_price ? Math.round(parseFloat(form.unit_price) * 100) : 0,
        currency: form.currency,
        low_stock_threshold: form.low_stock_threshold ? Number(form.low_stock_threshold) : 5,
      })).data,
    onSuccess: () => {
      setShowAdd(false);
      setForm(emptyForm);
      invalidateStock();
    },
  });

  const movementMutation = useMutation({
    mutationFn: async (item: any) => {
      const qty = Math.abs(Number(movement.quantity) || 0);
      const quantity_delta = movement.type === 'out' ? -qty : movement.type === 'in' ? qty : (Number(movement.quantity) || 0);
      return (await api.post(`/merchants/${item.merchant_id}/stock-items/${item.id}/movements`, {
        type: movement.type,
        quantity_delta,
        reason: movement.reason || undefined,
      })).data;
    },
    onSuccess: () => {
      setMovementItemId(null);
      setMovement({ type: 'in', quantity: '', reason: '' });
      invalidateStock();
    },
  });

  const visibleItems = storeFilter ? (items || []).filter((i: any) => i.merchant_id === storeFilter) : (items || []);

  // Shared between the mobile card list and the desktop table row below —
  // same state (movementItemId/movement), just inserted into a different
  // wrapper per layout.
  const renderMovementForm = (item: any) => (
    <div className="rounded-xl border border-border p-3 space-y-2">
      <Select value={movement.type} onChange={(e) => setMovement({ ...movement, type: e.target.value })}>
        {MOVEMENT_TYPES.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </Select>
      <Input
        type="number"
        placeholder="Quantité"
        value={movement.quantity}
        onChange={(e) => setMovement({ ...movement, quantity: e.target.value })}
      />
      <Input
        placeholder="Motif (optionnel)"
        value={movement.reason}
        onChange={(e) => setMovement({ ...movement, reason: e.target.value })}
      />
      <Button
        size="sm"
        className="w-full"
        disabled={!movement.quantity || movementMutation.isPending}
        onClick={() => movementMutation.mutate(item)}
      >
        {movementMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
        Confirmer
      </Button>
    </div>
  );

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <PageHeader title="Stock & Approvisionnement" />

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-5">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-2">
              <Boxes className="w-5 h-5 text-primary" />
            </div>
            <p className="text-xl font-bold text-foreground">{summary?.total_items || 0}</p>
            <p className="text-sm text-muted-foreground">Articles</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-2">
              <PackagePlus className="w-5 h-5 text-primary" />
            </div>
            <p className="text-xl font-bold text-foreground">{summary?.total_units || 0}</p>
            <p className="text-sm text-muted-foreground">Unités en stock</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center mb-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
            </div>
            <p className="text-xl font-bold text-foreground">{summary?.low_stock_count || 0}</p>
            <p className="text-sm text-muted-foreground">Stock bas</p>
          </CardContent>
        </Card>
      </div>

      {merchants?.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setStoreFilter(null)}
            className={`flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-medium border ${!storeFilter ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}
          >
            Toutes les boutiques
          </button>
          {merchants.map((m: any) => (
            <button
              key={m.id}
              onClick={() => setStoreFilter(m.id)}
              className={`flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-medium border ${storeFilter === m.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Articles</CardTitle>
          <Button size="sm" onClick={() => setShowAdd(true)} disabled={!merchants?.length}>
            <Plus className="mr-1 w-4 h-4" />
            Ajouter
          </Button>
        </CardHeader>
        <CardContent>
          {!merchants?.length && !showAdd && (
            <p className="text-muted-foreground text-center py-6">Crée d'abord une boutique pour pouvoir y ajouter du stock.</p>
          )}

          {showAdd && (
            <div className="rounded-xl border border-border p-4 mb-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-foreground text-sm">Nouvel article</p>
                <button onClick={() => setShowAdd(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              {merchants?.length > 1 && (
                <div className="space-y-2">
                  <Label htmlFor="stock_merchant">Boutique</Label>
                  <Select id="stock_merchant" value={form.merchant_id} onChange={(e) => setForm({ ...form, merchant_id: e.target.value })}>
                    <option value="">Sélectionner...</option>
                    {merchants.map((m: any) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="stock_name">Nom de l'article</Label>
                <Input id="stock_name" placeholder="Samsung Galaxy A54" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>

              {isElectronics && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="stock_brand">Marque</Label>
                      <Input id="stock_brand" placeholder="Samsung" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="stock_model">Modèle</Label>
                      <Input id="stock_model" placeholder="Galaxy A54" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="stock_serial">Numéro de série / IMEI</Label>
                    <Input id="stock_serial" value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label htmlFor="stock_condition">État</Label>
                      <Select id="stock_condition" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
                        <option value="">Sélectionner...</option>
                        {CONDITIONS.map((c) => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="stock_warranty">Garantie (mois)</Label>
                      <Input id="stock_warranty" type="number" inputMode="numeric" value={form.warranty_months} onChange={(e) => setForm({ ...form, warranty_months: e.target.value })} />
                    </div>
                  </div>
                </>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="stock_quantity">Quantité initiale</Label>
                  <Input id="stock_quantity" type="number" inputMode="numeric" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="stock_threshold">Seuil d'alerte</Label>
                  <Input id="stock_threshold" type="number" inputMode="numeric" value={form.low_stock_threshold} onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="stock_price">Prix de vente unitaire</Label>
                <Input id="stock_price" type="number" inputMode="decimal" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} />
              </div>

              <Button
                className="w-full"
                disabled={!form.name || !effectiveMerchantId || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                Enregistrer
              </Button>
            </div>
          )}

          {visibleItems.length ? (
            <>
              {/* Mobile — stacked cards, unchanged from before the desktop
                  table was added. */}
              <div className="md:hidden">
                {visibleItems.map((item: any) => (
                  <div key={item.id} className="py-3 border-b border-border last:border-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground truncate">{item.name}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {[item.brand, item.model].filter(Boolean).join(' ')}
                          {item.brand || item.model ? ' · ' : ''}
                          {item.merchant_name}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-semibold text-foreground">{item.quantity} unités</p>
                        <p className="text-sm text-muted-foreground">{formatCurrency(item.unit_price_cents, item.currency)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      {item.quantity <= item.low_stock_threshold && (
                        <Badge variant="error">Stock bas</Badge>
                      )}
                      {item.condition && <Badge variant="secondary" className="capitalize">{CONDITIONS.find((c) => c.value === item.condition)?.label || item.condition}</Badge>}
                      <button
                        className="ml-auto text-sm font-medium text-primary hover:underline"
                        onClick={() => setMovementItemId(movementItemId === item.id ? null : item.id)}
                      >
                        Mouvement de stock
                      </button>
                    </div>

                    {movementItemId === item.id && (
                      <div className="mt-3">{renderMovementForm(item)}</div>
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop — dense table, same data/actions as the mobile
                  cards above, just presented as rows so a long inventory
                  stays easy to scan on a wide screen. */}
              <table className="hidden md:table w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Article</th>
                    <th className="py-2 pr-3 font-medium">Marque / Modèle</th>
                    <th className="py-2 pr-3 font-medium">Boutique</th>
                    <th className="py-2 pr-3 font-medium">Quantité</th>
                    <th className="py-2 pr-3 font-medium">Prix</th>
                    <th className="py-2 pr-3 font-medium">État</th>
                    <th className="py-2 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item: any) => (
                    <Fragment key={item.id}>
                      <tr className="border-b border-border last:border-0">
                        <td className="py-3 pr-3 font-semibold text-foreground">{item.name}</td>
                        <td className="py-3 pr-3 text-muted-foreground">{[item.brand, item.model].filter(Boolean).join(' ') || '—'}</td>
                        <td className="py-3 pr-3 text-muted-foreground">{item.merchant_name}</td>
                        <td className="py-3 pr-3">
                          <div className="flex items-center gap-2">
                            {item.quantity}
                            {item.quantity <= item.low_stock_threshold && <Badge variant="error">Stock bas</Badge>}
                          </div>
                        </td>
                        <td className="py-3 pr-3 text-muted-foreground">{formatCurrency(item.unit_price_cents, item.currency)}</td>
                        <td className="py-3 pr-3">
                          {item.condition ? (
                            <Badge variant="secondary" className="capitalize">{CONDITIONS.find((c) => c.value === item.condition)?.label || item.condition}</Badge>
                          ) : '—'}
                        </td>
                        <td className="py-3">
                          <button
                            className="text-sm font-medium text-primary hover:underline whitespace-nowrap"
                            onClick={() => setMovementItemId(movementItemId === item.id ? null : item.id)}
                          >
                            Mouvement
                          </button>
                        </td>
                      </tr>
                      {movementItemId === item.id && (
                        <tr className="border-b border-border last:border-0">
                          <td colSpan={7} className="pb-4">{renderMovementForm(item)}</td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            !showAdd && merchants?.length > 0 && <p className="text-muted-foreground text-center py-6">Aucun article pour le moment</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
