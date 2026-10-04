import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/PageHeader';
import { CashierPinGate } from './CashierPinGate';
import { PosTill } from './PosTill';
import { PosHeldTickets, PosSalesHistory, PosSessionPanel } from './PosPanels';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  Lock, Store, Loader2, ShoppingCart, PauseCircle,
  Receipt, Vault, DoorClosed, DoorOpen,
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

  const [currency, setCurrency] = useState<'CDF' | 'USD'>('CDF');
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
      queryClient.invalidateQueries({ queryKey: ['pos-held', merchantId] });
    } catch (err: any) {
      setError(posErrorMessage(err, 'Impossible de reprendre ce ticket'));
    }
  };

  const [tab, setTab] = useState<Tab>('vente');
  const canSell = !!merchantId && !!session;

  // Held tickets count for the tab badge.
  const { data: heldData } = useQuery({
    queryKey: ['pos-held', merchantId],
    queryFn: async () =>
      (await api.get(`/merchants/${merchantId}/pos/tickets`, { params: { status: 'open', held: true, limit: 50 } })).data,
    enabled: !!merchantId && !!session,
  });
  const heldCount = heldData?.total || 0;

  return (
    <div className="p-6 pb-28 md:pb-6 space-y-5 max-w-2xl lg:max-w-7xl mx-auto">
      <PageHeader title="Caisse" />

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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {merchantName && (
          <p className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Store className="w-4 h-4" /> {merchantName}
          </p>
        )}
        {/* Currency — locked while a ticket is open (tickets are single-currency) */}
        <div className="flex gap-2 items-center ml-auto">
          {(['CDF', 'USD'] as const).map((c) => (
            <button
              key={c}
              disabled={!!ticket}
              onClick={() => setCurrency(c)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium border disabled:opacity-50 ${(ticket?.currency || currency) === c ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}
            >
              {c}
            </button>
          ))}
          {onLock && (
            <button onClick={onLock} className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground ml-2">
              <Lock className="w-4 h-4" /> Verrouiller
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
          {/* Tabs + session info — one row on desktop */}
          <div className="space-y-3 lg:space-y-0 lg:flex lg:items-center lg:gap-4">
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

          {tab === 'vente' && (
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
                setTab('attente');
              }}
            />
          )}

          {tab === 'attente' && (
            <PosHeldTickets merchantId={merchantId} onResume={resumeTicket} />
          )}

          {tab === 'ventes' && (
            <PosSalesHistory merchantId={merchantId} />
          )}

          {tab === 'caisse' && (
            <PosSessionPanel merchantId={merchantId} session={session} />
          )}
        </>
      )}
    </div>
  );
}
