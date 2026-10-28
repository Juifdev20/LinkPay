import { Truck as TruckIcon } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { isNetworkError, useNetwork, OFFLINE_FALLBACK } from '@/lib/network';
import { enqueue, newClientRef } from '@/lib/outbox';
import { useAuthStore } from '@/lib/auth-store';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { FormSheet } from '@/components/FormSheet';
import { formatDate, cn, countLabel } from '@/lib/utils';
import { Loader2, Plus, Check, X, PackageCheck } from 'lucide-react';

const STATUS: Record<string, { label: string; variant: 'warning' | 'success' | 'error' | 'secondary' }> = {
  pending: { label: 'En attente', variant: 'warning' },
  approved: { label: 'Validée', variant: 'success' },
  rejected: { label: 'Refusée', variant: 'error' },
  received: { label: 'Reçue', variant: 'secondary' },
};

/**
 * Restock requests (DECISIONS.md 23/10, phase B). The stock keeper asks to buy
 * what runs low (the form starts with the articles under their alert level);
 * the station's MANAGER approves or refuses and buys — the owner only when the
 * station has no manager (and they can always decide). A manager's own
 * request is approved at once. The station marks the goods received; the
 * stock itself is then entered as usual.
 * ?nouvelle=1 opens the form (from the low-stock alert).
 */
export default function RestockPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isOwner = user?.role === 'enterprise' || !!user?.acting_as_org_id;
  const [searchParams, setSearchParams] = useSearchParams();
  const [creating, setCreating] = useState(searchParams.get('nouvelle') === '1');
  const [filter, setFilter] = useState<string>('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (searchParams.get('nouvelle')) setSearchParams({}, { replace: true });
  }, []);

  const { data: org } = useQuery({ queryKey: ['my-organization'], queryFn: async () => (await api.get('/organizations/me')).data });
  const { data: stations } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data as { id: string; name: string }[],
    enabled: !!org?.id,
  });
  const { data: requests, isLoading } = useQuery({
    queryKey: ['restock-requests', org?.id, filter],
    queryFn: async () => (await api.get(`/organizations/${org.id}/restock-requests`, { params: filter ? { status: filter } : {} })).data as any[],
    enabled: !!org?.id,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['restock-requests', org?.id] });
  const update = useMutation({
    mutationFn: async ({ id, status, note }: { id: string; status: string; note?: string }) =>
      (await api.put(`/organizations/${org.id}/restock-requests/${id}`, { status, note })).data,
    onSuccess: () => { setError(''); refresh(); },
    onError: (err: any) => setError(err?.response?.data?.message || 'Action impossible, réessayez.'),
  });

  const canRequest = !isOwner || (stations?.length ?? 0) > 0;
  // The station's manager decides (the API checks it is their station); the owner can too. Never the stock keeper.
  const canDecide = isOwner || user?.role === 'gerant';

  return (
    <div className="p-4 md:p-6 pb-28 md:pb-6 space-y-5 max-w-6xl mx-auto">
      <PageHeader title="Demandes d'achat" />
      <p className="-mt-3 text-sm text-muted-foreground">
        {user?.role === 'magasinier'
          ? 'Vos demandes vont au gérant de la station, qui valide et achète (au patron si la station n\'a pas de gérant).'
          : user?.role === 'gerant'
            ? 'Vous validez les demandes du magasinier et passez les commandes. Vos propres demandes sont validées directement.'
            : 'Le gérant de chaque station valide les demandes de son magasinier. Celles des stations sans gérant arrivent chez vous.'}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {[['', 'Toutes'], ['pending', 'En attente'], ['approved', 'Validées'], ['received', 'Reçues'], ['rejected', 'Refusées']].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={cn('rounded-full border px-3 py-1.5 text-sm font-medium', filter === k ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground')}>
            {label}
          </button>
        ))}
        {canRequest && (
          <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}><Plus className="mr-1 h-4 w-4" /> Nouvelle demande</Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : !requests?.length ? (
        <EmptyState icon={TruckIcon} title="Aucune demande pour le moment" text="Quand un produit passe sous son seuil, créez une demande d'achat : le responsable la valide, puis vous la réceptionnez." />
      ) : (
        <div className="space-y-3 lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 lg:space-y-0">
          {requests.map((r) => (
            <Card key={r.id}>
              <CardContent className="space-y-3 pt-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">{r.station_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(r.created_at)}{r.requested_by_name ? ` · par ${r.requested_by_name}` : ''}
                    </p>
                  </div>
                  <Badge variant={STATUS[r.status]?.variant || 'secondary'}>{STATUS[r.status]?.label || r.status}</Badge>
                </div>
                <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                  {(r.items || []).map((i: any) => (
                    <li key={i.stock_item_id} className="flex justify-between gap-3 px-3 py-2">
                      <span className="min-w-0 truncate">{i.name} <span className="text-xs text-muted-foreground">(reste {i.current_qty})</span></span>
                      <span className="flex-shrink-0 font-semibold">× {i.wanted_qty}</span>
                    </li>
                  ))}
                </ul>
                {r.note && <p className="text-sm text-muted-foreground">« {r.note} »</p>}
                {r.decision_note && <p className="text-sm">Réponse : « {r.decision_note} »</p>}

                {canDecide && r.status === 'pending' && (
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1" disabled={update.isPending} onClick={() => update.mutate({ id: r.id, status: 'approved' })}>
                      <Check className="mr-1 h-4 w-4" /> Valider
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1" disabled={update.isPending} onClick={() => {
                      const note = window.prompt('Motif du refus (facultatif)') ?? undefined;
                      update.mutate({ id: r.id, status: 'rejected', note });
                    }}>
                      <X className="mr-1 h-4 w-4" /> Refuser
                    </Button>
                  </div>
                )}
                {r.status === 'approved' && (
                  <Button size="sm" variant="outline" className="w-full" disabled={update.isPending} onClick={() => update.mutate({ id: r.id, status: 'received' })}>
                    <PackageCheck className="mr-1 h-4 w-4" /> Marchandise reçue
                  </Button>
                )}
                {r.status === 'received' && (
                  <p className="text-xs text-muted-foreground">Reçue {r.received_at ? `le ${formatDate(r.received_at)}` : ''}{r.received_by_name ? ` · ${r.received_by_name}` : ''}. Le magasinier enregistre l'entrée en stock.</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {creating && stations && (
        <NewRequestSheet
          stations={stations}
          isOwner={isOwner}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); refresh(); }}
        />
      )}
    </div>
  );
}

/** The request form: starts with the station's articles under their alert level, quantities editable. */
function NewRequestSheet({ stations, isOwner, onClose, onCreated }: { stations: { id: string; name: string }[]; isOwner: boolean; onClose: () => void; onCreated: () => void }) {
  const [stationId, setStationId] = useState(stations[0]?.id || '');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  const { data: items, isLoading } = useQuery({
    queryKey: ['pos-catalog', stationId],
    queryFn: async () => (await api.get(`/merchants/${stationId}/stock-items`)).data as any[],
    enabled: !!stationId,
  });
  const low = (items || []).filter((i) => i.quantity <= (i.low_stock_threshold ?? 5));
  const shown = showAll ? items || [] : low;

  // Suggest refilling to twice the alert level.
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const i of low) next[i.id] = String(Math.max(1, (i.low_stock_threshold ?? 5) * 2 - i.quantity));
    setQty(next);
  }, [stationId, items?.length]);

  // Without network the request waits on the device and is sent (once) when the network is back.
  const send = useMutation({
    networkMode: 'always',
    mutationFn: async () => {
      const lines = Object.entries(qty)
        .map(([stock_item_id, v]) => ({ stock_item_id, wanted_qty: parseInt(v, 10) }))
        .filter((l) => l.wanted_qty > 0);
      const clientRef = newClientRef();
      const body = { items: lines, note: note || undefined, client_ref: clientRef };
      const queue = () => enqueue('restock.request', `Demande d'achat · ${lines.length} produit${lines.length > 1 ? 's' : ''}`, { merchant_id: stationId, body }, undefined, clientRef);
      if (!useNetwork.getState().online) return queue();
      try {
        return (await api.post(`/merchants/${stationId}/restock-requests`, body, OFFLINE_FALLBACK)).data;
      } catch (err) {
        if (isNetworkError(err)) return queue();
        throw err;
      }
    },
    onSuccess: onCreated,
    onError: (err: any) => setError(err?.response?.data?.message || "La demande n'a pas pu être envoyée."),
  });
  const count = Object.values(qty).filter((v) => parseInt(v, 10) > 0).length;

  return (
    <FormSheet onClose={onClose} title="Nouvelle demande">
      <div className="space-y-4 p-6">
        <h2 className="text-xl font-bold text-foreground">Demander un réapprovisionnement</h2>
        {isOwner && stations.length > 1 && (
          <select value={stationId} onChange={(e) => setStationId(e.target.value)} className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm">
            {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <p className="text-sm text-muted-foreground">
          {low.length ? `${countLabel(low.length, 'produit')} en stock bas proposé${low.length > 1 ? 's' : ''} — ajustez les quantités (0 pour retirer).` : 'Aucun produit en stock bas.'}
        </p>
        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border">
            {shown.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{i.name}</p>
                  <p className="text-xs text-muted-foreground">Reste {i.quantity} · alerte à {i.low_stock_threshold ?? 5}</p>
                </div>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  aria-label={`Quantité voulue pour ${i.name}`}
                  value={qty[i.id] ?? ''}
                  placeholder="0"
                  onChange={(e) => setQty({ ...qty, [i.id]: e.target.value.replace(/\D/g, '') })}
                  className="h-9 w-20 text-right"
                />
              </div>
            ))}
            {!shown.length && <p className="px-3 py-4 text-sm text-muted-foreground">Aucun produit.</p>}
          </div>
        )}
        {!showAll && (items?.length || 0) > low.length && (
          <button className="text-sm font-medium text-primary" onClick={() => setShowAll(true)}>Ajouter d'autres produits de la station</button>
        )}
        <Input placeholder="Note pour le responsable (facultatif)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button className="w-full" disabled={!count || send.isPending} onClick={() => send.mutate()}>
          {send.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Envoyer la demande ({count} produit{count > 1 ? 's' : ''})
        </Button>
      </div>
    </FormSheet>
  );
}
