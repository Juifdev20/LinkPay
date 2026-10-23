import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Minus, Plus, Search, ShoppingCart, Truck, UserPlus } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { FormSheet } from '@/components/FormSheet';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { OrderCard } from '@/components/supplier/OrderCard';
import { formatCurrency, formatDate, cn } from '@/lib/utils';

const msg = (e: any) => e?.response?.data?.message || 'Action impossible, réessayez.';

/**
 * « Mes fournisseurs » (DECISIONS.md 23/10, phase C), every sector, the buying side: invite a supplier by its
 * number, order from the catalog of those who accepted (quantities, delivery or not), then follow the order — pay it
 * by ScanLinkPay or announce a cash / Mobile Money payment, and confirm the reception (stock updated). The owner and
 * the managers order; the stock keeper follows the orders of their station and confirms receptions.
 */
export default function SupplierOrdersPage() {
  const user = useAuthStore((s) => s.user);
  const isOwner = user?.role === 'enterprise' || !!user?.acting_as_org_id;
  const canOrder = isOwner || user?.role === 'gerant';
  const [params, setParams] = useSearchParams();
  const tab = params.get('onglet') === 'fournisseurs' ? 'fournisseurs' : 'commandes';
  const { data: org } = useQuery({ queryKey: ['my-organization'], queryFn: async () => (await api.get('/organizations/me')).data });
  const [ordering, setOrdering] = useState<any | null>(null);

  if (!org) return <div className="p-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  return (
    <div className="p-4 md:p-6 pb-28 md:pb-6 space-y-5 max-w-3xl lg:max-w-6xl mx-auto">
      <PageHeader title="Mes fournisseurs" />
      <div className="flex gap-2">
        {[['commandes', 'Commandes'], ['fournisseurs', 'Fournisseurs']].map(([k, label]) => (
          <button key={k} onClick={() => setParams(k === 'commandes' ? {} : { onglet: k }, { replace: true })}
            className={cn('rounded-full border px-3 py-1.5 text-sm font-medium', tab === k ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground')}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'fournisseurs'
        ? <Suppliers orgId={org.id} canOrder={canOrder} onOrder={setOrdering} />
        : <Orders orgId={org.id} canOrder={canOrder} onNew={() => setParams({ onglet: 'fournisseurs' }, { replace: true })} />}
      {ordering && <NewOrderSheet orgId={org.id} supplier={ordering} isOwner={isOwner} onClose={() => setOrdering(null)} onDone={() => { setOrdering(null); setParams({}, { replace: true }); }} />}
    </div>
  );
}

function Suppliers({ orgId, canOrder, onOrder }: { orgId: string; canOrder: boolean; onOrder: (s: any) => void }) {
  const qc = useQueryClient();
  const [number, setNumber] = useState('');
  const [message, setMessage] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['supplier-links', orgId], queryFn: async () => (await api.get(`/organizations/${orgId}/supplier-links`)).data });
  const lookup = useQuery({
    queryKey: ['supplier-lookup', orgId, number.trim().toUpperCase()],
    queryFn: async () => (await api.get(`/organizations/${orgId}/supplier-lookup`, { params: { number: number.trim().toUpperCase() } })).data,
    enabled: /^F-\d{6}$/i.test(number.trim()),
    retry: false,
  });
  const invite = useMutation({
    mutationFn: async () => (await api.post(`/organizations/${orgId}/supplier-links`, { supplier_number: number.trim().toUpperCase(), message: message || undefined })).data,
    onSuccess: () => { setNumber(''); setMessage(''); qc.invalidateQueries({ queryKey: ['supplier-links', orgId] }); },
  });
  const end = useMutation({
    mutationFn: async (id: string) => (await api.put(`/organizations/${orgId}/supplier-links/${id}`, { action: 'end' })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier-links', orgId] }),
  });
  const suppliers = (data?.suppliers || []).filter((s: any) => s.status !== 'ended');

  return (
    <div className="space-y-4 lg:grid lg:grid-cols-[1fr_380px] lg:gap-6 lg:space-y-0 lg:items-start">
      <div className="space-y-3">
        {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : !suppliers.length ? (
          <EmptyState icon={Truck} title="Aucun fournisseur du réseau" text="Demandez son numéro de fournisseur (F-…) à votre grossiste, puis invitez-le." />
        ) : suppliers.map((s: any) => (
          <Card key={s.id}>
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">{s.supplier_name} <span className="text-xs text-muted-foreground font-normal">{s.supplier_number}</span></p>
                <p className="text-xs text-muted-foreground">
                  {s.status === 'pending' ? `Invitation envoyée le ${formatDate(s.created_at)} — en attente` : s.status === 'refused' ? 'A refusé votre invitation' : s.delivery_zone ? `Livre : ${s.delivery_zone}` : 'Fournisseur lié'}
                </p>
              </div>
              {s.status === 'accepted' && (
                <div className="flex items-center gap-2">
                  {!s.takes_orders && <Badge variant="secondary">Ne prend pas de commande pour l'instant</Badge>}
                  {canOrder && s.takes_orders && <Button size="sm" onClick={() => onOrder(s)}><ShoppingCart className="mr-1 w-4 h-4" /> Commander</Button>}
                  {canOrder && <Button size="sm" variant="ghost" className="text-destructive" disabled={end.isPending} onClick={() => window.confirm(`Ne plus commander chez ${s.supplier_name} ?`) && end.mutate(s.id)}>Retirer</Button>}
                </div>
              )}
              {s.status === 'pending' && <Badge variant="warning">En attente</Badge>}
            </CardContent>
          </Card>
        ))}
      </div>

      {canOrder && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="font-semibold flex items-center gap-2"><UserPlus className="w-4 h-4" /> Inviter un fournisseur</p>
            <div className="space-y-1.5">
              <Label htmlFor="sup_number">Numéro de fournisseur</Label>
              <Input id="sup_number" placeholder="F-123456" value={number} onChange={(e) => setNumber(e.target.value)} />
            </div>
            {lookup.data && (
              <div className="rounded-xl border border-border p-3 text-sm">
                <p className="font-semibold">{lookup.data.display_name}</p>
                <p className="text-xs text-muted-foreground">{[lookup.data.address, lookup.data.delivery_zone && `Livre : ${lookup.data.delivery_zone}`].filter(Boolean).join(' · ') || '—'}</p>
              </div>
            )}
            {lookup.isError && <p className="text-sm text-destructive">{msg(lookup.error)}</p>}
            <Input placeholder="Message (facultatif)" maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
            {invite.isError && <p className="text-sm text-destructive">{msg(invite.error)}</p>}
            <Button className="w-full" disabled={!lookup.data || invite.isPending} onClick={() => invite.mutate()}>
              {invite.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />} Envoyer l'invitation
            </Button>
            <p className="text-xs text-muted-foreground">Une fois accepté, il apparaît aussi dans la liste des fournisseurs de vos produits.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const FILTERS = [['', 'Toutes'], ['submitted', 'Envoyées'], ['confirmed', 'À payer'], ['paid', 'Payées'], ['delivered', 'À réceptionner'], ['received', 'Reçues']] as const;

function Orders({ orgId, canOrder, onNew }: { orgId: string; canOrder: boolean; onNew: () => void }) {
  const [filter, setFilter] = useState('');
  const { data: orders, isLoading, error } = useQuery({
    queryKey: ['supplier-orders', orgId, 'client', filter],
    queryFn: async () => (await api.get(`/organizations/${orgId}/supplier-orders`, { params: { side: 'client', ...(filter ? { status: filter } : {}) } })).data as any[],
    refetchInterval: 30_000,
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={cn('rounded-full border px-3 py-1 text-xs font-medium', filter === k ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground')}>{label}</button>
        ))}
        {canOrder && <Button size="sm" className="ml-auto" onClick={onNew}><Plus className="mr-1 w-4 h-4" /> Nouvelle commande</Button>}
      </div>
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : error ? <p className="text-sm text-destructive">{msg(error)}</p> : !orders?.length ? (
        <EmptyState icon={ShoppingCart} title="Aucune commande" text="Commandez chez un fournisseur qui vous a accepté : onglet « Fournisseurs »." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {orders.map((o) => <OrderCard key={o.id} order={o} side="client" orgId={orgId} />)}
        </div>
      )}
    </div>
  );
}

/** The supplier's catalog with quantities, the receiving station (owner), delivery or not, a note. */
function NewOrderSheet({ orgId, supplier, isOwner, onClose, onDone }: { orgId: string; supplier: any; isOwner: boolean; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['supplier-network-catalog', orgId, supplier.supplier_org_id],
    queryFn: async () => (await api.get(`/organizations/${orgId}/supplier-network/${supplier.supplier_org_id}/catalog`)).data,
  });
  const { data: stations } = useQuery({
    queryKey: ['org-merchants', orgId],
    queryFn: async () => (await api.get(`/organizations/${orgId}/merchants`)).data as { id: string; name: string }[],
    enabled: isOwner,
  });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [station, setStation] = useState('');
  const [delivery, setDelivery] = useState(false);
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  // The supplier's station that serves us: its own catalog, stock and delivery fee.
  const supStations: any[] = data?.stations || [];
  const [from, setFrom] = useState('');
  const serving = from || (supStations.length === 1 ? supStations[0].merchant_id : '');
  const servingStation = supStations.find((st) => st.merchant_id === serving);
  const items: any[] = (data?.items || []).filter((i: any) => !serving || i.merchant_id === serving);
  const shown = useMemo(() => items.filter((i) => !query.trim() || i.name.toLowerCase().includes(query.trim().toLowerCase())), [items, query]);
  const lines = items.filter((i) => (qty[i.id] || 0) > 0);
  const currencies = new Set(lines.map((l) => l.currency));
  const totals = lines.reduce<Record<string, number>>((acc, l) => ({ ...acc, [l.currency]: (acc[l.currency] || 0) + l.price_cents * qty[l.id] }), {});
  const receiving = isOwner ? station || (stations?.length === 1 ? stations[0].id : '') : 'mine';
  const tooFew = lines.find((l) => qty[l.id] < l.min_quantity);
  const order = useMutation({
    mutationFn: async () => (await api.post(`/organizations/${orgId}/supplier-orders`, {
      supplier_org_id: supplier.supplier_org_id,
      supplier_merchant_id: serving,
      ...(isOwner ? { merchant_id: receiving } : {}),
      items: lines.map((l) => ({ catalog_item_id: l.id, quantity: qty[l.id] })),
      delivery_requested: delivery, delivery_address: delivery ? address || undefined : undefined, note: note || undefined,
    })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['supplier-orders', orgId] }); onDone(); },
  });
  const set = (id: string, n: number) => setQty({ ...qty, [id]: Math.max(0, Math.min(1_000_000, Math.round(n) || 0)) });
  const fee = servingStation?.default_delivery_fee_cents ?? null;
  const feeCur = servingStation?.default_delivery_currency || 'CDF';

  return (
    <FormSheet onClose={onClose} title={`Commander chez ${supplier.supplier_name}`}>
      <div className="p-6 space-y-4">
        <h2 className="text-xl font-bold">Commander chez {supplier.supplier_name}</h2>
        {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : error ? <p className="text-sm text-destructive">{msg(error)}</p> : (
          <>
            {supStations.length > 1 && (
              <div className="space-y-1.5">
                <Label>Station du fournisseur qui vous sert</Label>
                <div className="flex flex-wrap gap-2">
                  {supStations.map((st) => (
                    <button key={st.merchant_id} onClick={() => { setFrom(st.merchant_id); setQty({}); }}
                      className={cn('rounded-xl border px-3 py-2 text-left text-sm', serving === st.merchant_id ? 'border-primary bg-primary/5' : 'border-border')}>
                      <span className="font-semibold block">{st.name}</span>
                      {st.delivery_zone && <span className="text-xs text-muted-foreground">Livre : {st.delivery_zone}</span>}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Choisissez la plus proche : chaque station a son stock et ses prix.</p>
              </div>
            )}
            {!serving && supStations.length > 1 ? null : (<>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Rechercher dans son catalogue…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            {!items.length && <p className="text-sm text-muted-foreground">Son catalogue est vide pour le moment.</p>}
            <ul className="divide-y divide-border rounded-xl border border-border">
              {shown.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{i.name}</p>
                    <p className="text-xs text-muted-foreground">{formatCurrency(i.price_cents, i.currency)} · {i.available > 0 ? `${i.available} disponible${i.available > 1 ? 's' : ''}` : 'en rupture'}{i.min_quantity > 1 ? ` · min. ${i.min_quantity}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="outline" className="h-8 w-8" aria-label={`Moins de ${i.name}`} onClick={() => set(i.id, (qty[i.id] || 0) - 1)}><Minus className="w-3 h-3" /></Button>
                    <Input aria-label={`Quantité ${i.name}`} className="h-8 w-16 text-center" inputMode="numeric" value={qty[i.id] || ''} placeholder="0" onChange={(e) => set(i.id, Number(e.target.value))} />
                    <Button size="icon" variant="outline" className="h-8 w-8" aria-label={`Plus de ${i.name}`} onClick={() => set(i.id, (qty[i.id] || 0) + (qty[i.id] ? 1 : Math.max(1, i.min_quantity)))}><Plus className="w-3 h-3" /></Button>
                  </div>
                </li>
              ))}
            </ul>

            {isOwner && (stations?.length ?? 0) > 1 && (
              <div className="space-y-1.5">
                <Label htmlFor="ord_station">Votre station qui reçoit la marchandise</Label>
                <Select id="ord_station" value={station} onChange={(e) => setStation(e.target.value)}>
                  <option value="">Choisir…</option>
                  {(stations || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </div>
            )}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={delivery} onChange={(e) => setDelivery(e.target.checked)} />
              <span>
                Me faire livrer
                <span className="block text-xs text-muted-foreground">
                  Le fournisseur fixe les frais de cette livraison (selon la distance) en confirmant ; ils s'ajoutent au total.
                  {fee != null && ` Habituellement depuis ${servingStation.name} : ${formatCurrency(fee, feeCur)}.`}
                </span>
              </span>
            </label>
            {delivery && <Input placeholder="Adresse de livraison" maxLength={255} value={address} onChange={(e) => setAddress(e.target.value)} />}
            <Input placeholder="Note pour le fournisseur (facultatif)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />

            <div className="rounded-xl bg-secondary px-4 py-3 text-sm">
              {lines.length ? Object.entries(totals).map(([c, v]) => <p key={c} className="font-semibold">Produits : {formatCurrency(v, c)}{delivery ? ' + livraison' : ''}</p>) : <p className="text-muted-foreground">Choisissez les quantités.</p>}
              {currencies.size > 1 && <p className="text-destructive text-xs mt-1">Une commande se fait dans une seule devise : séparez les produits en CDF et en USD.</p>}
              {tooFew && <p className="text-destructive text-xs mt-1">« {tooFew.name} » : au moins {tooFew.min_quantity}.</p>}
            </div>
            {order.isError && <p className="text-sm text-destructive">{msg(order.error)}</p>}
            <Button className="w-full" size="lg" disabled={!lines.length || currencies.size > 1 || !!tooFew || !receiving || !serving || order.isPending} onClick={() => order.mutate()}>
              {order.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />} Envoyer la commande{servingStation && supStations.length > 1 ? ` à ${servingStation.name}` : ''}
            </Button>
            </>)}
          </>
        )}
      </div>
    </FormSheet>
  );
}
