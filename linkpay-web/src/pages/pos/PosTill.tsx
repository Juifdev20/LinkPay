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
import { posErrorMessage } from './PosPage';
import { formatCurrency } from '@/lib/utils';
import { Search, Trash2, PauseCircle, Loader2, ShieldAlert, Minus, Plus, PackageX } from 'lucide-react';

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
  const [error, setError] = useState('');

  const ensureTicket = async () => {
    if (ticket?.status === 'open') return ticket;
    const { data } = await api.post(`/merchants/${merchantId}/pos/tickets`, { currency });
    localStorage.setItem(ticketKey, data.id);
    setTicket(data);
    return data;
  };

  // ------------------------------------------------------------------
  // Product lookup: live name search, Enter = barcode (USB scanners type
  // the code then send Enter — same handler serves both). The search box
  // keeps/regains focus after every add so a scanner-driven cashier never
  // needs to touch the mouse.
  // ------------------------------------------------------------------
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const ticketCurrency = ticket?.currency || currency;

  const { data: results } = useQuery({
    queryKey: ['pos-search', merchantId, debouncedQuery, ticketCurrency],
    queryFn: async () =>
      (await api.get(`/merchants/${merchantId}/stock-items/search`, { params: { q: debouncedQuery } })).data,
    enabled: !!merchantId && debouncedQuery.length >= 2,
    select: (items: any[]) => items.filter((i) => i.currency === ticketCurrency),
  });

  // Full catalog for the quick-pick grid (desktop) — filtered by rayon chip
  // and ticket currency client-side; also feeds the mobile grid.
  const { data: catalog } = useQuery({
    queryKey: ['pos-catalog', merchantId],
    queryFn: async () => (await api.get(`/merchants/${merchantId}/stock-items`)).data,
    enabled: !!merchantId,
  });
  const [category, setCategory] = useState('');
  const catalogItems: any[] = (catalog || []).filter((i: any) => i.currency === ticketCurrency);
  const categories = [...new Set(catalogItems.map((i) => i.category).filter(Boolean))] as string[];
  const gridItems = category ? catalogItems.filter((i) => i.category === category) : catalogItems;

  const [adding, setAdding] = useState(false);
  const addProduct = async (item: any) => {
    setAdding(true);
    setError('');
    try {
      const t = await ensureTicket();
      const { data } = await api.post(`/merchants/${t.merchant_id}/pos/tickets/${t.id}/items`, {
        stock_item_id: item.id,
        quantity: 1,
      });
      setTicket(data);
      setQuery('');
    } catch (err: any) {
      setError(posErrorMessage(err, "Impossible d'ajouter l'article"));
    } finally {
      setAdding(false);
      searchRef.current?.focus();
    }
  };

  const scanBarcode = async () => {
    const code = query.trim();
    if (!code) return;
    try {
      const { data: item } = await api.get(
        `/merchants/${merchantId}/stock-items/by-barcode/${encodeURIComponent(code)}`,
      );
      await addProduct(item);
      setQuery('');
    } catch {
      // Not a registered barcode — leave the name-search results visible.
    }
  };

  // ------------------------------------------------------------------
  // Quantity steppers: − reduces in place (zero goes through the
  // authorized void below); + reuses the same patch with stock checks.
  // ------------------------------------------------------------------
  const setQuantity = async (item: any, quantity: number) => {
    setError('');
    try {
      const { data } = await api.patch(
        `/merchants/${merchantId}/pos/tickets/${ticket.id}/items/${item.id}`,
        { quantity },
      );
      setTicket(data);
      searchRef.current?.focus();
    } catch (err: any) {
      setError(posErrorMessage(err, 'Quantité impossible'));
    }
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
      clearTicket();
    } catch (err: any) {
      setError(posErrorMessage(err, "Impossible d'annuler le ticket"));
    }
  };

  const finishPaidTicket = (t: any) => {
    clearTicket();
    setPaidTicket(t);
    setPaymentOpen(false);
    queryClient.invalidateQueries({ queryKey: ['pos-search'] });
    queryClient.invalidateQueries({ queryKey: ['pos-catalog', merchantId] });
    queryClient.invalidateQueries({ queryKey: ['pos-sales', merchantId] });
  };

  const items: any[] = ticket?.items || [];
  const activeItems = items.filter((i) => i.status !== 'voided');
  const voidedItems = items.filter((i) => i.status === 'voided');
  const tvaRate = Number(ticket?.merchant?.pos_tva_rate_pct ?? 0);
  const searching = query.trim().length >= 2;

  const resultRow = (item: any) => (
    <button
      key={item.id}
      disabled={adding || item.quantity <= 0}
      onClick={() => addProduct(item)}
      className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-accent/50 disabled:opacity-50"
    >
      <div className="min-w-0">
        <p className="font-medium text-foreground truncate">{item.name}</p>
        {item.category && <p className="text-xs text-muted-foreground">{item.category}</p>}
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-semibold text-foreground">{formatCurrency(item.unit_price_cents, item.currency)}</p>
        <p className="text-xs text-muted-foreground">{item.quantity > 0 ? `${item.quantity} en stock` : 'Rupture'}</p>
      </div>
    </button>
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
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              ref={searchRef}
              className="pl-9 h-11 text-base"
              placeholder="Rechercher un produit ou scanner un code-barres…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && scanBarcode()}
              autoFocus
            />
          </div>

          {searching && results && (
            <div className="rounded-xl border border-border divide-y divide-border max-h-72 overflow-y-auto bg-card">
              {results.length ? (
                results.map(resultRow)
              ) : (
                <p className="px-3 py-3 text-sm text-muted-foreground">Aucun produit « {debouncedQuery} »</p>
              )}
            </div>
          )}

          {/* Quick-pick grid — shown when not searching. Desktop gets rayon
              chips + a dense grid; mobile/tablet gets a compact 3-col grid. */}
          {!searching && (
            <>
              {categories.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  <button
                    onClick={() => setCategory('')}
                    className={`flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-medium border ${!category ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}
                  >
                    Tous
                  </button>
                  {categories.map((c) => (
                    <button
                      key={c}
                      onClick={() => setCategory(category === c ? '' : c)}
                      className={`flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-medium border ${category === c ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}

              {gridItems.length ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-5 gap-2 lg:max-h-[calc(100vh-300px)] lg:overflow-y-auto lg:pr-1">
                  {gridItems.map((item: any) => (
                    <button
                      key={item.id}
                      disabled={adding || item.quantity <= 0}
                      onClick={() => addProduct(item)}
                      className="rounded-xl border border-border bg-card p-3 text-left hover:border-primary hover:shadow-sm transition-all disabled:opacity-50 flex flex-col gap-1 min-h-[86px]"
                    >
                      <p className="text-sm font-medium text-foreground leading-tight line-clamp-2">{item.name}</p>
                      <div className="mt-auto flex items-end justify-between gap-1">
                        <p className="text-sm font-bold text-primary truncate">{formatCurrency(item.unit_price_cents, item.currency)}</p>
                        {item.quantity <= 0 ? (
                          <Badge variant="error" className="text-[10px] gap-0.5"><PackageX className="w-3 h-3" />0</Badge>
                        ) : item.quantity <= (item.low_stock_threshold ?? 5) ? (
                          <Badge variant="secondary" className="text-[10px]">{item.quantity}</Badge>
                        ) : null}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                !catalogItems.length && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    Aucun produit en {ticketCurrency} dans cette boutique — ajoutez-en depuis la page Stock.
                  </p>
                )
              )}
            </>
          )}
        </div>

        {/* ============================== Ticket ============================== */}
        <Card className="lg:sticky lg:top-20">
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
          <CardContent className="space-y-3">
            {!activeItems.length && !voidedItems.length && (
              <p className="text-sm text-muted-foreground text-center py-6">
                Scannez un code-barres ou touchez un produit pour démarrer la vente.
              </p>
            )}

            {activeItems.length > 0 && (
              <div className="divide-y divide-border max-h-[40vh] lg:max-h-[32vh] overflow-y-auto -mx-1 px-1">
                {activeItems.map((item: any) => (
                  <div key={item.id} className="flex items-center gap-2 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground truncate">{item.product_name_snapshot}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(item.unit_price_cents_snapshot, ticket.currency)} / u
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => (item.quantity <= 1 ? setVoidTarget(item) : setQuantity(item, item.quantity - 1))}
                        className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent"
                        title={item.quantity <= 1 ? 'Annuler la ligne' : 'Réduire'}
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-7 text-center text-sm font-semibold text-foreground">{item.quantity}</span>
                      <button
                        onClick={() => setQuantity(item, item.quantity + 1)}
                        className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent"
                        title="Augmenter"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <p className="font-semibold text-foreground flex-shrink-0 w-20 text-right">
                      {formatCurrency(item.line_total_cents, ticket.currency)}
                    </p>
                    <button onClick={() => setVoidTarget(item)} className="text-muted-foreground hover:text-destructive flex-shrink-0" title="Annuler la ligne">
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

            {/* Totals HT / TVA / TTC + pay — always in view on desktop */}
            {ticket && (
              <div className="border-t border-border pt-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <p className="text-muted-foreground">Sous-total HT</p>
                  <p className="font-medium text-foreground">{formatCurrency(ticket.subtotal_cents || 0, ticketCurrency)}</p>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <p className="text-muted-foreground">TVA ({tvaRate}%)</p>
                  <p className="font-medium text-foreground">{formatCurrency(ticket.tva_cents || 0, ticketCurrency)}</p>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <p className="text-muted-foreground">Total TTC</p>
                  <p className="text-2xl font-bold text-foreground">{formatCurrency(ticket.total_cents || 0, ticketCurrency)}</p>
                </div>
                <Button className="w-full mt-1" size="lg" onClick={() => setPaymentOpen(true)} disabled={!activeItems.length}>
                  Encaisser
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
              {voidTarget.quantity} × {voidTarget.product_name_snapshot} — {formatCurrency(voidTarget.line_total_cents, ticket.currency)}
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
