import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/PageHeader';
import { FormSheet } from '@/components/FormSheet';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { CashierPinGate } from './CashierPinGate';
import { PosTill } from './PosTill';
import { PosHeldTickets, PosSalesHistory, PosSessionPanel } from './PosPanels';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  Lock, Store, Loader2, ShoppingCart, PauseCircle,
  Receipt, Vault, DoorClosed, DoorOpen, MoreHorizontal, ChevronRight,
} from 'lucide-react';

export const STAFF_ROLES = ['magasinier', 'vendeur', 'caissier', 'comptable'];

export function posErrorMessage(err: any, fallback: string) {
  const msg = err?.response?.data?.message;
  return Array.isArray(msg) ? msg.join(', ') : msg || fallback;
}

type Tab = 'vente' | 'attente' | 'ventes' | 'caisse';

const TABS: { key: Tab; label: string; icon: any }[] = [
  { key: 'vente', label: 'Vente', icon: ShoppingCart },
  { key: 'attente', label: 'En attente', icon: PauseCircle },
  { key: 'ventes', label: 'Ventes', icon: Receipt },
  { key: 'caisse', label: 'Caisse', icon: Vault },
];

/**
 * Point of sale ("caisse") — spec module supermarché 1.2/1.3.
 * One till per (store, currency): a session is opened with a float, tickets
 * are built by scanning/searching products, parked on hold or settled by
 * cash, ScanLinkPay or a mix of both, then closed with a cash count that
 * produces a discrepancy report. Four tabs:
 *   Vente      — the live ticket (search, lines, void, HT/TVA/TTC, payment)
 *   En attente — parked tickets to resume
 *   Ventes     — paid tickets of the store (receipt re-view)
 *   Caisse     — session detail, cash in/out, close, past sessions
 */
export default function PosPage() {
  const user = useAuthStore((s) => s.user);
  const isStaff = STAFF_ROLES.includes(user?.role || '');
  const [gateKey, setGateKey] = useState(0);

  const till = <PosScreen onLock={isStaff ? () => setGateKey((k) => k + 1) : undefined} />;
  return isStaff ? <CashierPinGate key={gateKey}>{till}</CashierPinGate> : till;
}

function PosScreen({ onLock }: { onLock?: () => void }) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  // ------------------------------------------------------------------
  // Store + currency resolution (same pattern as Stock.tsx): merchants
  // carry merchant_id in their JWT; org owners and org-scoped staff pick
  // among the org's stores (auto-selected when there's exactly one).
  // ------------------------------------------------------------------
  const [pickedMerchant, setPickedMerchant] = useState('');

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
    enabled: !user?.merchant_id,
  });

  const { data: merchants } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data,
    enabled: !user?.merchant_id && !!org?.id,
  });

  const merchantId = user?.merchant_id || pickedMerchant || (merchants?.length === 1 ? merchants[0].id : '');
  const merchantName = merchants?.find((m: any) => m.id === merchantId)?.name;

  // Remembered per device — the till always reopening on CDF made a USD
  // session look closed ("ouvrez la caisse" again) on every visit.
  const [currency, setCurrencyState] = useState<'CDF' | 'USD'>(() => {
    try { return localStorage.getItem('pos-currency') === 'USD' ? 'USD' : 'CDF'; } catch { return 'CDF'; }
  });
  const setCurrency = (c: 'CDF' | 'USD') => {
    setCurrencyState(c);
    try { localStorage.setItem('pos-currency', c); } catch { /* not persisted */ }
  };
  const [error, setError] = useState('');

  // ------------------------------------------------------------------
  // Cash-register session — one open session per (store, currency).
  // ------------------------------------------------------------------
  const { data: sessionData, isLoading: sessionLoading } = useQuery({
    queryKey: ['cash-session', merchantId, currency],
    queryFn: async () => (await api.get(`/merchants/${merchantId}/cash-register/sessions/current`, { params: { currency } })).data,
    enabled: !!merchantId,
  });
  const session = sessionData?.session;

  // On arrival only: if this currency's till is closed but the other one is
  // open, land on the open one. Once — afterwards the cashier must stay free
  // to switch to the closed currency to open it too.
  const otherCurrency = currency === 'CDF' ? 'USD' : 'CDF';
  const autoPicked = useRef(false);
  const { data: otherSessionData } = useQuery({
    queryKey: ['cash-session', merchantId, otherCurrency],
    queryFn: async () => (await api.get(`/merchants/${merchantId}/cash-register/sessions/current`, { params: { currency: otherCurrency } })).data,
    enabled: !!merchantId && !autoPicked.current && !sessionLoading && !session,
  });
  useEffect(() => {
    if (autoPicked.current || !merchantId || sessionLoading) return;
    if (session) { autoPicked.current = true; return; }
    if (otherSessionData === undefined) return;
    autoPicked.current = true;
    if (otherSessionData.session) setCurrency(otherCurrency);
  }, [merchantId, sessionLoading, session, otherSessionData]);

  const [openingFloat, setOpeningFloat] = useState('');
  const [opening, setOpening] = useState(false);

  const openSession = async () => {
    setOpening(true);
    setError('');
    try {
      await api.post(`/merchants/${merchantId}/cash-register/sessions`, {
        currency,
        opening_float_cents: Math.round(parseFloat(openingFloat || '0') * 100),
      });
      setOpeningFloat('');
      queryClient.invalidateQueries({ queryKey: ['cash-session', merchantId, currency] });
    } catch (err: any) {
      setError(posErrorMessage(err, "Impossible d'ouvrir la caisse"));
    } finally {
      setOpening(false);
    }
  };

  // ------------------------------------------------------------------
  // Current ticket — kept in localStorage keyed by (store, currency) so a
  // refresh doesn't silently orphan the sale.
  // ------------------------------------------------------------------
  const ticketKey = merchantId ? `pos_ticket:${merchantId}:${currency}` : '';
  const [ticket, setTicket] = useState<any>(null);

  useEffect(() => {
    setTicket(null);
    if (!ticketKey) return;
    const id = localStorage.getItem(ticketKey);
    if (!id) return;
    api.get(`/merchants/${merchantId}/pos/tickets/${id}`)
      .then(({ data }) => {
        if (data.status === 'open') setTicket(data);
        else localStorage.removeItem(ticketKey);
      })
      .catch(() => localStorage.removeItem(ticketKey));
  }, [ticketKey]);

  const clearTicket = () => {
    if (ticketKey) localStorage.removeItem(ticketKey);
    setTicket(null);
  };

  const resumeTicket = async (t: any) => {
    try {
      const { data } = await api.post(`/merchants/${merchantId}/pos/tickets/${t.id}/resume`);
      localStorage.setItem(ticketKey, data.id);
      setTicket(data);
      setTab('vente');
      setMobileSheet(null);
      queryClient.invalidateQueries({ queryKey: ['pos-held', merchantId] });
    } catch (err: any) {
      setError(posErrorMessage(err, 'Impossible de reprendre ce ticket'));
    }
  };

  const [tab, setTab] = useState<Tab>('vente');
  const canSell = !!merchantId && !!session;

  // Mobile/tablet: the till is the whole screen; the secondary tabs live in
  // a "⋯" menu opening as bottom sheets instead of a permanent tab bar.
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [mobileSheet, setMobileSheet] = useState<null | 'menu' | 'attente' | 'ventes' | 'caisse'>(null);
  const activeTab: Tab = isDesktop ? tab : 'vente';

  // Held tickets count for the tab badge.
  const { data: heldData } = useQuery({
    queryKey: ['pos-held', merchantId],
    queryFn: async () =>
      (await api.get(`/merchants/${merchantId}/pos/tickets`, { params: { status: 'open', held: true, limit: 50 } })).data,
    enabled: !!merchantId && !!session,
  });
  const heldCount = heldData?.total || 0;

  return (
    <div className="px-4 pt-4 pb-28 md:pb-6 lg:p-6 space-y-4 lg:space-y-5 max-w-2xl lg:max-w-7xl mx-auto">
      {/* Reached from the bottom "Vente" tab on mobile — no back arrow/title there. */}
      <div className="hidden lg:block">
        <PageHeader title="Caisse" />
      </div>

      {!user?.merchant_id && merchants?.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {merchants.map((m: any) => (
            <button
              key={m.id}
              onClick={() => setPickedMerchant(m.id)}
              className={`flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-medium border ${merchantId === m.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}

      {/* Store + currency + lock — one compact row on desktop so the till
          itself gets the maximum vertical space. */}
      <div className="flex items-center gap-2 lg:gap-4">
        {merchantName && (
          <p className="min-w-0 text-sm text-muted-foreground flex items-center gap-1.5">
            <Store className="w-4 h-4 flex-shrink-0" /> <span className="truncate">{merchantName}</span>
          </p>
        )}
        {/* Currency — locked while a ticket is open (tickets are single-currency) */}
        <div className="flex gap-1.5 lg:gap-2 items-center ml-auto flex-shrink-0">
          {(['CDF', 'USD'] as const).map((c) => (
            <button
              key={c}
              disabled={!!ticket}
              onClick={() => setCurrency(c)}
              className={`rounded-full px-3 lg:px-4 py-1 lg:py-1.5 text-xs lg:text-sm font-medium border disabled:opacity-50 ${(ticket?.currency || currency) === c ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}
            >
              {c}
            </button>
          ))}
          {onLock && (
            <button onClick={onLock} className="hidden lg:flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground ml-2">
              <Lock className="w-4 h-4" /> Verrouiller
            </button>
          )}
          {/* Mobile: everything secondary behind one button */}
          {canSell && (
            <button
              onClick={() => setMobileSheet('menu')}
              className="lg:hidden relative w-9 h-9 rounded-full border border-border flex items-center justify-center text-muted-foreground"
              aria-label="Plus d'options de caisse"
            >
              <MoreHorizontal className="w-5 h-5" />
              {heldCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-destructive ring-2 ring-background" />
              )}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!merchantId && !user?.merchant_id && merchants && merchants.length === 0 && (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">Aucune boutique dans cette organisation.</CardContent></Card>
      )}
      {merchantId && sessionLoading && (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      )}

      {/* Session gate — the till is unusable until the drawer is opened */}
      {merchantId && !sessionLoading && !session && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <DoorClosed className="w-5 h-5" /> Caisse fermée ({currency})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Ouvrez une session avec le fond de caisse avant de vendre.</p>
            <div className="space-y-2">
              <Label htmlFor="float">Fond de caisse ({currency})</Label>
              <Input
                id="float"
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={openingFloat}
                onChange={(e) => setOpeningFloat(e.target.value)}
              />
            </div>
            <Button className="w-full" onClick={openSession} disabled={opening}>
              {opening && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
              <DoorOpen className="mr-2 w-4 h-4" />
              Ouvrir la caisse
            </Button>
          </CardContent>
        </Card>
      )}

      {canSell && (
        <>
          {/* Tabs + session info — desktop only (mobile: the "⋯" menu) */}
          <div className="hidden lg:flex lg:items-center lg:gap-4">
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-secondary p-1 lg:w-[440px] lg:flex-shrink-0">
              {TABS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`relative flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs sm:text-sm font-medium transition-colors ${tab === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{label}</span>
                  {key === 'attente' && heldCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                      {heldCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Vault className="w-3.5 h-3.5" />
              Session {session.currency} ouverte le {formatDate(session.opened_at)} · Fond : {formatCurrency(session.opening_float_cents, session.currency)}
            </p>
          </div>

          {activeTab === 'vente' && (
            <PosTill
              merchantId={merchantId}
              currency={currency}
              ticket={ticket}
              setTicket={setTicket}
              ticketKey={ticketKey}
              clearTicket={clearTicket}
              onHeld={() => {
                clearTicket();
                queryClient.invalidateQueries({ queryKey: ['pos-held', merchantId] });
                // Desktop shows the held list; on mobile the till stays up
                // for the next customer (the "⋯" dot signals held tickets).
                setTab('attente');
              }}
            />
          )}

          {activeTab === 'attente' && (
            <PosHeldTickets merchantId={merchantId} onResume={resumeTicket} />
          )}

          {activeTab === 'ventes' && (
            <PosSalesHistory merchantId={merchantId} />
          )}

          {activeTab === 'caisse' && (
            <PosSessionPanel merchantId={merchantId} session={session} />
          )}

          {/* Mobile "⋯" menu and the secondary panels it opens */}
          {mobileSheet === 'menu' && (
            <FormSheet onClose={() => setMobileSheet(null)} title="Options de caisse">
              <div className="p-4 pb-6 space-y-1">
                {[
                  { key: 'attente' as const, label: 'Tickets en attente', icon: PauseCircle, badge: heldCount || undefined },
                  { key: 'ventes' as const, label: 'Ventes du jour', icon: Receipt },
                  { key: 'caisse' as const, label: 'Caisse', icon: Vault, hint: `Session ${session.currency} · Fond ${formatCurrency(session.opening_float_cents, session.currency)}` },
                ].map(({ key, label, icon: Icon, badge, hint }) => (
                  <button
                    key={key}
                    onClick={() => setMobileSheet(key)}
                    className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-accent"
                  >
                    <Icon className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium text-foreground">{label}</span>
                      {hint && <span className="block text-xs text-muted-foreground truncate">{hint}</span>}
                    </span>
                    {badge && (
                      <span className="min-w-6 h-6 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                        {badge}
                      </span>
                    )}
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </button>
                ))}
                {onLock && (
                  <button
                    onClick={() => { setMobileSheet(null); onLock(); }}
                    className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-accent"
                  >
                    <Lock className="w-5 h-5 text-muted-foreground" />
                    <span className="flex-1 font-medium text-foreground">Verrouiller la caisse</span>
                  </button>
                )}
              </div>
            </FormSheet>
          )}
          {mobileSheet && mobileSheet !== 'menu' && (
            <FormSheet
              onClose={() => setMobileSheet(null)}
              title={mobileSheet === 'attente' ? 'Tickets en attente' : mobileSheet === 'ventes' ? 'Ventes du jour' : 'Caisse'}
            >
              <div className="p-4 pb-6 space-y-4">
                <h2 className="text-lg font-bold text-foreground">
                  {mobileSheet === 'attente' ? 'Tickets en attente' : mobileSheet === 'ventes' ? 'Ventes du jour' : 'Caisse'}
                </h2>
                {mobileSheet === 'attente' && <PosHeldTickets merchantId={merchantId} onResume={resumeTicket} />}
                {mobileSheet === 'ventes' && <PosSalesHistory merchantId={merchantId} />}
                {mobileSheet === 'caisse' && <PosSessionPanel merchantId={merchantId} session={session} />}
              </div>
            </FormSheet>
          )}
        </>
      )}
    </div>
  );
}
