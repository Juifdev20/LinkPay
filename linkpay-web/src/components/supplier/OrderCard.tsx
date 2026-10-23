import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, PackageCheck, Printer, Truck, Wallet, X } from 'lucide-react';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { FormSheet } from '@/components/FormSheet';
import { formatCurrency, formatDate } from '@/lib/utils';
import { ORDER_STATUS, PAYMENT_LABEL, printOrderTicket, ticketTitle, type OrderStatus } from '@/lib/supplier-order';

const msg = (e: any) => e?.response?.data?.message || 'Action impossible, réessayez.';
const toCents = (v: string) => Math.round(parseFloat(v.replace(',', '.')) * 100);

/**
 * One order between enterprises, from either side (DECISIONS.md 23/10): its lines, totals and steps, and the
 * buttons of the step it is at — supplier: confirm with this order's delivery fee / refuse, payment received outside
 * the app, delivery; client: pay by ScanLinkPay or announce a cash / Mobile Money payment, cancel, reception.
 */
export function OrderCard({ order, side, orgId, defaultFee }: { order: any; side: 'client' | 'supplier'; orgId: string; defaultFee?: { cents: number | null; currency: string | null } }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [fee, setFee] = useState(() => (defaultFee?.cents != null && defaultFee.currency === order.currency ? String(defaultFee.cents / 100) : ''));
  const [reference, setReference] = useState('');
  const [receiving, setReceiving] = useState(false);
  const status = order.status as OrderStatus;
  const s = ORDER_STATUS[status];

  const act = useMutation({
    mutationFn: async ({ path, body }: { path: string; body?: any }) => (await api.post(`/organizations/${orgId}/supplier-orders/${order.id}/${path}`, body || {})).data,
    onSuccess: () => { setError(''); qc.invalidateQueries({ queryKey: ['supplier-orders', orgId] }); },
    onError: (e) => setError(msg(e)),
  });
  const busy = act.isPending;
  const feeValid = !order.delivery_requested || (fee.trim() !== '' && !Number.isNaN(parseFloat(fee.replace(',', '.'))) && parseFloat(fee.replace(',', '.')) >= 0);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-foreground truncate">{side === 'client' ? order.supplier_name : order.client_name}</p>
            <p className="text-xs text-muted-foreground">
              {order.number} · {formatDate(order.created_at)}
              {side === 'supplier' && order.client_station_name ? ` · ${order.client_station_name}` : ''}
              {side === 'client' && order.client_station_name ? ` · pour ${order.client_station_name}` : ''}
            </p>
          </div>
          <Badge variant={s.variant}>{s[side]}</Badge>
        </div>

        <ul className="divide-y divide-border rounded-xl border border-border text-sm">
          {(order.items || []).map((l: any) => (
            <li key={l.id} className="flex justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate">{l.name} <span className="text-xs text-muted-foreground">× {l.quantity}</span></span>
              <span className="flex-shrink-0">{formatCurrency(l.unit_price_cents * l.quantity, order.currency)}</span>
            </li>
          ))}
        </ul>
        <div className="text-sm space-y-0.5">
          {order.delivery_requested && (
            <p className="flex justify-between text-muted-foreground">
              <span>Livraison{order.delivery_address ? ` (${order.delivery_address})` : ''}</span>
              <span>{status === 'submitted' ? 'à fixer par le fournisseur' : formatCurrency(order.delivery_fee_cents, order.currency)}</span>
            </p>
          )}
          <p className="flex justify-between font-bold"><span>Total</span><span>{formatCurrency(order.total_cents, order.currency)}</span></p>
          {order.paid_at && <p className="text-xs text-muted-foreground">Payée le {formatDate(order.paid_at)} · {PAYMENT_LABEL[order.payment_method] || order.payment_method}{order.payment_reference ? ` · réf. ${order.payment_reference}` : ''}</p>}
          {order.note && <p className="text-xs text-muted-foreground">Note du client : « {order.note} »</p>}
          {order.supplier_note && <p className="text-xs text-muted-foreground">Note du fournisseur : « {order.supplier_note} »</p>}
          {status === 'confirmed' && order.client_declared_payment_at && (
            <p className="text-xs rounded-lg bg-warning/10 text-warning px-2 py-1">
              {side === 'supplier' ? 'Le client annonce avoir payé' : 'Vous avez annoncé un paiement'} {order.payment_method === 'cash' ? 'en espèces' : 'par Mobile Money'}
              {order.payment_reference ? ` (réf. ${order.payment_reference})` : ''} — {side === 'supplier' ? 'vérifiez puis confirmez.' : 'le fournisseur doit le confirmer.'}
            </p>
          )}
        </div>

        {/* ---- supplier side ---- */}
        {side === 'supplier' && status === 'submitted' && (
          <div className="space-y-2">
            {order.delivery_requested && (
              <div className="space-y-1">
                <Label htmlFor={`fee-${order.id}`} className="text-xs">Frais de livraison de cette commande ({order.currency})</Label>
                <Input id={`fee-${order.id}`} inputMode="decimal" placeholder="0" value={fee} onChange={(e) => setFee(e.target.value)} />
                <p className="text-[11px] text-muted-foreground">Selon la distance : ils s'ajoutent au total du client.</p>
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" disabled={busy || !feeValid} onClick={() => act.mutate({ path: 'confirm', body: { delivery_fee_cents: order.delivery_requested ? toCents(fee || '0') : 0 } })}>
                <Check className="mr-1 h-4 w-4" /> Confirmer
              </Button>
              <Button size="sm" variant="outline" className="flex-1" disabled={busy} onClick={() => {
                const note = window.prompt('Motif du refus (facultatif)');
                if (note !== null) act.mutate({ path: 'refuse', body: { note: note || undefined } });
              }}>
                <X className="mr-1 h-4 w-4" /> Refuser
              </Button>
            </div>
          </div>
        )}
        {side === 'supplier' && status === 'confirmed' && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Un paiement ScanLinkPay du client passe tout seul en « payée ». Payé autrement ? Confirmez-le ici.</p>
            <Input placeholder="Référence (facultatif, ex. n° Mobile Money)" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" disabled={busy} onClick={() => act.mutate({ path: 'confirm-payment', body: { method: 'cash', reference: reference || undefined } })}>Reçu en espèces</Button>
              <Button size="sm" className="flex-1" disabled={busy} onClick={() => act.mutate({ path: 'confirm-payment', body: { method: 'mobile_money', reference: reference || undefined } })}>Reçu par Mobile Money</Button>
            </div>
          </div>
        )}
        {side === 'supplier' && status === 'paid' && (
          <Button size="sm" className="w-full" disabled={busy} onClick={() => window.confirm('Valider la livraison ? Les quantités sortent du stock de la station d’expédition.') && act.mutate({ path: 'deliver' })}>
            <Truck className="mr-1 h-4 w-4" /> Valider la livraison
          </Button>
        )}

        {/* ---- client side ---- */}
        {side === 'client' && status === 'confirmed' && (
          <div className="space-y-2">
            {order.payment_link_token && (
              <Button asChild size="sm" className="w-full">
                <Link to={`/p/${order.payment_link_token}`}><Wallet className="mr-1 h-4 w-4" /> Payer {formatCurrency(order.total_cents, order.currency)} avec ScanLinkPay</Link>
              </Button>
            )}
            {!order.client_declared_payment_at && (
              <>
                <Input placeholder="Référence du paiement (facultatif)" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" disabled={busy} onClick={() => act.mutate({ path: 'declare-payment', body: { method: 'cash', reference: reference || undefined } })}>Payé en espèces</Button>
                  <Button size="sm" variant="outline" className="flex-1" disabled={busy} onClick={() => act.mutate({ path: 'declare-payment', body: { method: 'mobile_money', reference: reference || undefined } })}>Payé par Mobile Money</Button>
                </div>
              </>
            )}
          </div>
        )}
        {side === 'client' && (status === 'submitted' || status === 'confirmed') && (
          <Button size="sm" variant="ghost" className="w-full text-destructive" disabled={busy} onClick={() => window.confirm('Annuler cette commande ?') && act.mutate({ path: 'cancel' })}>
            Annuler la commande
          </Button>
        )}
        {side === 'client' && status === 'delivered' && (
          <Button size="sm" className="w-full" onClick={() => setReceiving(true)}>
            <PackageCheck className="mr-1 h-4 w-4" /> Confirmer la réception
          </Button>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {!['refused', 'cancelled'].includes(status) && (
          <Button size="sm" variant="outline" className="w-full" onClick={() => printOrderTicket(order)}>
            <Printer className="mr-1 h-4 w-4" /> {ticketTitle(status)}
          </Button>
        )}
      </CardContent>
      {receiving && <ReceiveSheet order={order} orgId={orgId} onClose={() => setReceiving(false)} onDone={() => { setReceiving(false); qc.invalidateQueries({ queryKey: ['supplier-orders', orgId] }); }} />}
    </Card>
  );
}

const NEW = '__nouveau__';

/**
 * Reception: each line goes into a product of the receiving station — the one with the same barcode is proposed,
 * another can be picked, or a new product is made (its sale price is then asked). Stock comes in, the purchase price
 * becomes the order's price.
 */
function ReceiveSheet({ order, orgId, onClose, onDone }: { order: any; orgId: string; onClose: () => void; onDone: () => void }) {
  const { data: stock } = useQuery({
    queryKey: ['org-stock-items', orgId],
    queryFn: async () => (await api.get(`/organizations/${orgId}/stock-items`)).data as any[],
  });
  const products = useMemo(() => (stock || []).filter((s) => s.merchant_id === order.client_merchant_id), [stock, order.client_merchant_id]);
  const [choice, setChoice] = useState<Record<string, { target: string; price: string }>>({});
  const pick = (l: any) => choice[l.id] ?? { target: (l.barcode && products.find((p) => p.barcode === l.barcode)?.id) || NEW, price: '' };
  const lines = order.items || [];
  const ready = !!stock && lines.every((l: any) => {
    const c = pick(l);
    return c.target !== NEW || (parseFloat(c.price.replace(',', '.')) > 0);
  });
  const save = useMutation({
    mutationFn: async () => api.post(`/organizations/${orgId}/supplier-orders/${order.id}/receive`, {
      lines: lines.map((l: any) => {
        const c = pick(l);
        return c.target === NEW ? { order_item_id: l.id, sale_price_cents: toCents(c.price) } : { order_item_id: l.id, stock_item_id: c.target };
      }),
    }),
    onSuccess: onDone,
  });

  return (
    <FormSheet onClose={onClose} title="Réception">
      <div className="p-6 space-y-4">
        <h2 className="text-xl font-bold">Réception de {order.number}</h2>
        <p className="text-sm text-muted-foreground">Vérifiez la marchandise. Chaque ligne entre dans votre stock ; le prix d'achat devient celui de la commande.</p>
        {!stock && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        {stock && lines.map((l: any) => {
          const c = pick(l);
          return (
            <div key={l.id} className="rounded-xl border border-border p-3 space-y-2">
              <p className="text-sm font-medium">{l.name} <span className="text-muted-foreground">× {l.quantity}</span> · {formatCurrency(l.unit_price_cents, order.currency)} l'unité</p>
              <Select aria-label={`Produit pour ${l.name}`} value={c.target} onChange={(e) => setChoice({ ...choice, [l.id]: { ...c, target: e.target.value } })}>
                <option value={NEW}>Nouveau produit dans mon stock</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.barcode && p.barcode === l.barcode ? ' (même code-barres)' : ''}</option>)}
              </Select>
              {c.target === NEW && (
                <div className="space-y-1">
                  <Label className="text-xs">Votre prix de vente ({order.currency})</Label>
                  <Input inputMode="decimal" placeholder="0" value={c.price} onChange={(e) => setChoice({ ...choice, [l.id]: { ...c, price: e.target.value } })} />
                </div>
              )}
            </div>
          );
        })}
        {save.isError && <p className="text-sm text-destructive">{msg(save.error)}</p>}
        <Button className="w-full" size="lg" disabled={!ready || save.isPending} onClick={() => save.mutate()}>
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Confirmer la réception et mettre à jour le stock
        </Button>
      </div>
    </FormSheet>
  );
}
