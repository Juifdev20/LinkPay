import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { FormSheet } from '@/components/FormSheet';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PosReceipt } from './PosReceipt';
import { posErrorMessage } from './PosPage';
import { formatCurrency, formatDate, formatShortDate } from '@/lib/utils';
import {
  PauseCircle, Play, Loader2, Banknote, QrCode, Receipt,
  DoorClosed, Vault, ChevronRight, History,
} from 'lucide-react';

const METHOD_LABELS: Record<string, string> = {
  cash: 'Espèces',
  scanlinkpay: 'ScanLinkPay',
  mixed: 'Mixte',
};

const STATUS_LABELS: Record<string, string> = {
  paid: 'Payé',
  open: 'En cours',
  cancelled: 'Annulé',
};

// ---------------------------------------------------------------------
// Tickets en attente — "mise en attente de tickets" (spec 1.2)
// ---------------------------------------------------------------------
export function PosHeldTickets({ merchantId, onResume }: { merchantId: string; onResume: (ticket: any) => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [cancelTarget, setCancelTarget] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['pos-held', merchantId],
    queryFn: async () =>
      (await api.get(`/merchants/${merchantId}/pos/tickets`, { params: { status: 'open', held: true, limit: 50 } })).data,
    refetchInterval: 15000,
  });
  const tickets: any[] = data?.data || [];

  const cancel = async () => {
    try {
      await api.post(`/merchants/${merchantId}/pos/tickets/${cancelTarget.id}/cancel`, {});
      setCancelTarget(null);
      queryClient.invalidateQueries({ queryKey: ['pos-held', merchantId] });
    } catch (err: any) {
      setError(posErrorMessage(err, "Impossible d'annuler ce ticket"));
      setCancelTarget(null);
    }
  };

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      {!tickets.length && (
        <Card><CardContent className="pt-6 text-center space-y-2">
          <PauseCircle className="w-8 h-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Aucun ticket en attente — utilisez « Attente » sur un ticket en cours pour le mettre de côté.</p>
        </CardContent></Card>
      )}

      {tickets.map((t) => (
        <Card key={t.id}>
          <CardContent className="pt-4 pb-4 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground">Ticket #{t.ticket_number ?? '—'}</p>
              <p className="text-xs text-muted-foreground truncate">
                {formatDate(t.created_at)}{t.hold_note ? ` · ${t.hold_note}` : ''}
              </p>
            </div>
            <p className="font-bold text-foreground flex-shrink-0">{formatCurrency(t.total_cents, t.currency)}</p>
            <div className="flex gap-2 flex-shrink-0">
              <Button size="sm" onClick={() => onResume(t)}>
                <Play className="w-3.5 h-3.5 mr-1" /> Reprendre
              </Button>
              <Button size="sm" variant="outline" onClick={() => setCancelTarget(t)}>Annuler</Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(o) => !o && setCancelTarget(null)}
        title="Annuler ce ticket en attente ?"
        description="Le ticket sera clôturé sans encaissement."
        confirmLabel="Annuler le ticket"
        variant="destructive"
        onConfirm={cancel}
      />
    </div>
  );
}

// ---------------------------------------------------------------------
// Historique des ventes — paid tickets, receipt re-viewable
// ---------------------------------------------------------------------
export function PosSalesHistory({ merchantId }: { merchantId: string }) {
  const [page, setPage] = useState(1);
  const [receiptTicket, setReceiptTicket] = useState<any>(null);
  const [loadingReceipt, setLoadingReceipt] = useState(false);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['pos-sales', merchantId, page],
    queryFn: async () =>
      (await api.get(`/merchants/${merchantId}/pos/tickets`, { params: { status: 'paid', page, limit: 20 } })).data,
  });
  const tickets: any[] = data?.data || [];
  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / (data?.limit || 20)));

  const openReceipt = async (t: any) => {
    setLoadingReceipt(true);
    setError('');
    try {
      const { data: full } = await api.get(`/merchants/${merchantId}/pos/tickets/${t.id}`);
      setReceiptTicket(full);
    } catch (err: any) {
      setError(posErrorMessage(err, 'Impossible de charger le reçu'));
    } finally {
      setLoadingReceipt(false);
    }
  };

  if (isLoading) return <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      {!tickets.length && (
        <Card><CardContent className="pt-6 text-center space-y-2">
          <Receipt className="w-8 h-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Aucune vente encaissée pour l'instant.</p>
        </CardContent></Card>
      )}

      {tickets.map((t) => (
        <button key={t.id} onClick={() => openReceipt(t)} disabled={loadingReceipt} className="w-full text-left">
          <Card className="hover:bg-accent/40 transition-colors">
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground">Ticket #{t.ticket_number ?? '—'}</p>
                <p className="text-xs text-muted-foreground">{formatDate(t.paid_at || t.created_at)}</p>
              </div>
              <Badge variant="secondary" className="flex items-center gap-1">
                {t.payment_method === 'cash' && <Banknote className="w-3 h-3" />}
                {t.payment_method === 'scanlinkpay' && <QrCode className="w-3 h-3" />}
                {METHOD_LABELS[t.payment_method] || t.payment_method}
              </Badge>
              <p className="font-bold text-foreground flex-shrink-0">{formatCurrency(t.total_cents, t.currency)}</p>
              <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            </CardContent>
          </Card>
        </button>
      ))}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Précédent</Button>
          <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Suivant</Button>
        </div>
      )}

      {receiptTicket && <PosReceipt ticket={receiptTicket} onClose={() => setReceiptTicket(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Caisse — current session detail (live expected), movements, close,
// and past sessions with their rapprochement (spec 1.3).
// ---------------------------------------------------------------------
export function PosSessionPanel({ merchantId, session }: { merchantId: string; session: any }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [movement, setMovement] = useState({ type: 'cash_out', amount: '', reason: '' });
  const [closingCount, setClosingCount] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const { data: detail } = useQuery({
    queryKey: ['cash-session-detail', session?.id],
    queryFn: async () => (await api.get(`/merchants/${merchantId}/cash-register/sessions/${session.id}`)).data,
    enabled: !!session?.id,
  });

  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['cash-sessions', merchantId],
    queryFn: async () => (await api.get(`/merchants/${merchantId}/cash-register/sessions`, { params: { limit: 20 } })).data,
  });
  const pastSessions: any[] = (history?.data || []).filter((s: any) => s.id !== session?.id);

  const addMovement = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/merchants/${merchantId}/cash-register/sessions/${session.id}/movements`, {
        type: movement.type,
        amount_cents: Math.round(parseFloat(movement.amount) * 100),
        reason: movement.reason || undefined,
      });
      setMovement({ type: 'cash_out', amount: '', reason: '' });
      queryClient.invalidateQueries({ queryKey: ['cash-session-detail', session.id] });
    } catch (err: any) {
      setError(posErrorMessage(err, 'Mouvement impossible'));
    } finally {
      setBusy(false);
    }
  };

  const closeSession = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post(`/merchants/${merchantId}/cash-register/sessions/${session.id}/close`, {
        closing_counted_cents: Math.round(parseFloat(closingCount || '0') * 100),
      });
      setClosingCount('');
      queryClient.invalidateQueries({ queryKey: ['cash-session', merchantId] });
      queryClient.invalidateQueries({ queryKey: ['cash-sessions', merchantId] });
      queryClient.invalidateQueries({ queryKey: ['cash-session-detail', session.id] });
    } catch (err: any) {
      setError(posErrorMessage(err, 'Fermeture impossible'));
    } finally {
      setBusy(false);
    }
  };

  const movements: any[] = detail?.movements || [];
  const liveExpected = detail?.expected_cents;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      {/* Live session state */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Vault className="w-5 h-5" /> Session en cours ({session.currency})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Ouverte le</span><span className="text-foreground">{formatDate(session.opened_at)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Fond de caisse</span><span className="text-foreground">{formatCurrency(session.opening_float_cents, session.currency)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Ventes espèces</span><span className="text-foreground">{formatCurrency(detail?.cash_sales_cents ?? 0, session.currency)}</span></div>
          <div className="flex justify-between font-semibold border-t border-border pt-2">
            <span className="text-foreground">Attendu dans le tiroir</span>
            <span className="text-foreground">{liveExpected !== undefined ? formatCurrency(liveExpected, session.currency) : '…'}</span>
          </div>
        </CardContent>
      </Card>

      {/* Manual cash movements */}
      <Card>
        <CardHeader><CardTitle className="text-base">Mouvement de caisse</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Select value={movement.type} onChange={(e) => setMovement({ ...movement, type: e.target.value })}>
            <option value="cash_in">Entrée d'espèces (+)</option>
            <option value="cash_out">Sortie d'espèces (−)</option>
          </Select>
          <Input type="number" inputMode="decimal" placeholder={`Montant (${session.currency})`} value={movement.amount} onChange={(e) => setMovement({ ...movement, amount: e.target.value })} />
          <Input placeholder="Motif (ex : dépôt bancaire, achat fournitures)" value={movement.reason} onChange={(e) => setMovement({ ...movement, reason: e.target.value })} />
          <Button variant="outline" className="w-full" disabled={!movement.amount || busy} onClick={addMovement}>
            {busy && <Loader2 className="mr-2 w-4 h-4 animate-spin" />} Enregistrer le mouvement
          </Button>

          {movements.length > 0 && (
            <div className="border-t border-border pt-3 space-y-1.5">
              {movements.map((m: any) => (
                <div key={m.id} className="flex justify-between text-sm">
                  <span className="text-muted-foreground truncate">
                    {m.type === 'cash_in' ? 'Entrée' : 'Sortie'}{m.reason ? ` — ${m.reason}` : ''}
                  </span>
                  <span className={m.type === 'cash_in' ? 'text-success font-medium' : 'text-destructive font-medium'}>
                    {m.type === 'cash_in' ? '+' : '−'}{formatCurrency(m.amount_cents, session.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Close + count */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><DoorClosed className="w-5 h-5" /> Fermer la caisse</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="closing">Montant compté dans le tiroir ({session.currency})</Label>
            <Input id="closing" type="number" inputMode="decimal" placeholder="0" value={closingCount} onChange={(e) => setClosingCount(e.target.value)} />
          </div>
          <Button variant="destructive" className="w-full" disabled={closingCount === '' || busy} onClick={() => setConfirmClose(true)}>
            <DoorClosed className="mr-2 w-4 h-4" /> Clôturer la session
          </Button>
        </CardContent>
      </Card>

      {/* Past sessions — rapprochement history */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><History className="w-5 h-5" /> Sessions passées</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {historyLoading && <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
          {!historyLoading && !pastSessions.length && (
            <p className="text-sm text-muted-foreground text-center py-2">Aucune session passée.</p>
          )}
          {pastSessions.map((s) => (
            <button key={s.id} onClick={() => setDetailId(s.id)} className="w-full text-left rounded-xl border border-border px-3 py-2.5 hover:bg-accent/40 transition-colors">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {formatShortDate(s.opened_at)} · {s.currency}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {s.cashier?.full_name || s.cashier?.email || '—'}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <Badge variant={s.status === 'open' ? 'secondary' : 'outline'}>{STATUS_LABELS[s.status] || s.status}</Badge>
                  {s.status === 'closed' && (
                    <p className={`text-xs font-semibold mt-0.5 ${s.discrepancy_cents === 0 ? 'text-success' : 'text-destructive'}`}>
                      Écart {s.discrepancy_cents > 0 ? '+' : ''}{formatCurrency(s.discrepancy_cents, s.currency)}
                    </p>
                  )}
                </div>
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Clôturer la session ?"
        description={`Attendu dans le tiroir : ${liveExpected !== undefined ? formatCurrency(liveExpected, session.currency) : '…'}. L'écart sera calculé à partir de votre comptage.`}
        confirmLabel="Clôturer"
        variant="destructive"
        onConfirm={closeSession}
      />

      {detailId && <SessionDetailSheet merchantId={merchantId} sessionId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

/** Read-only recap of a past session: amounts, discrepancy, tickets. */
function SessionDetailSheet({ merchantId, sessionId, onClose }: { merchantId: string; sessionId: string; onClose: () => void }) {
  const { data: s, isLoading } = useQuery({
    queryKey: ['cash-session-detail', sessionId],
    queryFn: async () => (await api.get(`/merchants/${merchantId}/cash-register/sessions/${sessionId}`)).data,
  });

  return (
    <FormSheet onClose={onClose} title="Détail de session">
      <div className="p-6 max-w-lg mx-auto space-y-4">
        {isLoading && <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>}
        {s && (
          <>
            <div className="text-center">
              <p className="font-semibold text-foreground">Session {s.currency}</p>
              <p className="text-sm text-muted-foreground">
                {formatDate(s.opened_at)}{s.closed_at ? ` → ${formatDate(s.closed_at)}` : ' · en cours'}
              </p>
            </div>

            <div className="rounded-xl bg-secondary p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Fond de caisse</span><span className="text-foreground">{formatCurrency(s.opening_float_cents, s.currency)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Ventes espèces</span><span className="text-foreground">{formatCurrency(s.cash_sales_cents ?? 0, s.currency)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Attendu</span><span className="font-semibold text-foreground">{formatCurrency(s.expected_cents ?? 0, s.currency)}</span></div>
              {s.status === 'closed' && (
                <>
                  <div className="flex justify-between"><span className="text-muted-foreground">Compté</span><span className="font-semibold text-foreground">{formatCurrency(s.closing_counted_cents ?? 0, s.currency)}</span></div>
                  <div className="flex justify-between border-t border-border pt-2">
                    <span className="text-muted-foreground">Écart</span>
                    <span className={`font-bold ${s.discrepancy_cents === 0 ? 'text-success' : 'text-destructive'}`}>
                      {s.discrepancy_cents > 0 ? '+' : ''}{formatCurrency(s.discrepancy_cents, s.currency)}
                    </span>
                  </div>
                </>
              )}
            </div>

            {(s.movements || []).length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-foreground">Mouvements</p>
                {s.movements.map((m: any) => (
                  <div key={m.id} className="flex justify-between text-sm">
                    <span className="text-muted-foreground truncate">{m.type === 'cash_in' ? 'Entrée' : 'Sortie'}{m.reason ? ` — ${m.reason}` : ''}</span>
                    <span className={m.type === 'cash_in' ? 'text-success' : 'text-destructive'}>
                      {m.type === 'cash_in' ? '+' : '−'}{formatCurrency(m.amount_cents, s.currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-foreground">Tickets ({(s.tickets || []).length})</p>
              {(s.tickets || []).map((t: any) => (
                <div key={t.id} className="flex justify-between items-center text-sm">
                  <span className="text-muted-foreground">
                    #{t.ticket_number ?? '—'} · {METHOD_LABELS[t.payment_method] || STATUS_LABELS[t.status] || t.status}
                  </span>
                  <span className={`font-medium ${t.status === 'cancelled' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                    {formatCurrency(t.total_cents, t.currency)}
                  </span>
                </div>
              ))}
              {!(s.tickets || []).length && <p className="text-sm text-muted-foreground">Aucun ticket.</p>}
            </div>
          </>
        )}
      </div>
    </FormSheet>
  );
}
