import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/lib/auth-store';
import { FormSheet } from '@/components/FormSheet';
import { useHomeData, type Currency } from '@/components/home/useHomeData';
import {
  HomeHero, QuickActions, SalesChart, AlertsList, TopProducts, RecentSales, OnlinePaymentsLine,
  type QuickAction, type HomeAlert,
} from '@/components/home/HomeWidgets';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CurrencySelector } from '@/components/CurrencySelector';
import { DualCurrencyStat } from '@/components/DualCurrencyStat';
import OnboardingWizard from '@/pages/organization/OnboardingWizard';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { Building2, Loader2, QrCode, X, Copy, Check, Trophy, MinusCircle, Clock, AlertTriangle, ShoppingCart, PackagePlus, PauseCircle } from 'lucide-react';
import { shareOrCopy, publicOrigin } from '@/lib/share';


/** Shown once the KYB onboarding is submitted, while status is still
 * 'pending' — distinct from the wizard itself (onboarding_completed_at is
 * already set) and from the active dashboard (status isn't 'active' yet). */
function PendingValidationScreen({ orgName }: { orgName: string }) {
  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[70vh] text-center max-w-md mx-auto">
      <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center mb-4">
        <Clock className="w-8 h-8 text-warning" />
      </div>
      <h1 className="text-xl font-bold text-foreground mb-2">Dossier en cours de validation</h1>
      <p className="text-muted-foreground">
        Le dossier de <span className="font-semibold text-foreground">{orgName}</span> a été soumis et est en attente de validation par l'équipe ScanLinkPay. Vous serez notifié dès qu'une décision sera prise.
      </p>
    </div>
  );
}

/** Shown when a super admin rejected the submission — surfaces the reason
 * and lets the owner reopen the wizard (pre-filled from the org's already
 * saved fields) to correct and resubmit via OnboardingWizard's own
 * POST .../submit call. */
function RejectedScreen({ orgId, orgName, org, reason }: { orgId: string; orgName: string; org: Record<string, any>; reason?: string }) {
  const [correcting, setCorrecting] = useState(false);
  if (correcting) return <OnboardingWizard orgId={orgId} orgName={orgName} org={org} />;

  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[70vh] text-center max-w-md mx-auto">
      <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <AlertTriangle className="w-8 h-8 text-destructive" />
      </div>
      <h1 className="text-xl font-bold text-foreground mb-2">Dossier rejeté</h1>
      <p className="text-muted-foreground mb-1">
        Le dossier de <span className="font-semibold text-foreground">{orgName}</span> a été rejeté.
      </p>
      {reason && (
        <div className="w-full rounded-xl bg-destructive/5 border border-destructive/20 px-4 py-3 my-3 text-sm text-destructive text-left">
          {reason}
        </div>
      )}
      <Button className="mt-3" onClick={() => setCorrecting(true)}>
        Corriger et resoumettre
      </Button>
    </div>
  );
}

export default function OrganizationProfilePage() {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [showQrPresent, setShowQrPresent] = useState(false);

  const { data: org, isLoading } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => {
      const { data } = await api.get('/organizations/me');
      return data;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ['org-stats', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/stats`)).data,
    enabled: !!org?.id,
  });

  const { data: merchants } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data,
    enabled: !!org?.id,
  });

  const { data: storesBreakdown } = useQuery({
    queryKey: ['org-stores-breakdown', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/stores-breakdown`)).data,
    enabled: !!org?.id && (merchants?.length || 0) > 1,
  });

  const [showAddExpense, setShowAddExpense] = useState(false);
  const [newExpense, setNewExpense] = useState({ amount: '', description: '', currency: 'CDF' as 'CDF' | 'USD' });
  const addExpenseMutation = useMutation({
    mutationFn: async () =>
      (await api.post(`/organizations/${org.id}/expenses`, {
        amount_cents: Math.round((parseFloat(newExpense.amount) || 0) * 100),
        currency: newExpense.currency,
        description: newExpense.description,
      })).data,
    onSuccess: () => {
      setShowAddExpense(false);
      setNewExpense({ amount: '', description: '', currency: 'CDF' });
      queryClient.invalidateQueries({ queryKey: ['org-expenses-summary', org.id] });
    },
  });

  // Unfiltered on purpose — Supabase Realtime's postgres_changes filter only
  // supports a single `column=eq.value`, not an IN-list of this org's
  // merchant ids, so we can't scope the subscription itself. The REST
  // refetch this triggers stays correctly scoped server-side; this just
  // means the dashboard also refetches on unrelated merchants' activity.
  useRealtimeInvalidate('transactions', undefined, [['org-stats', org?.id], ['org-stores-breakdown', org?.id]], !!org?.id);


  // ------------------------------------------------------------------
  // Home dashboard data — the till (supermarket) or Ventes module sales,
  // stock alerts and held tickets (see components/home/useHomeData).
  // ------------------------------------------------------------------
  const user = useAuthStore((st) => st.user);
  const navigate = useNavigate();
  const [currency, setCurrencyState] = useState<Currency>(() => {
    try { return localStorage.getItem('pos-currency') === 'USD' ? 'USD' : 'CDF'; } catch { return 'CDF'; }
  });
  const setCurrency = (c: Currency) => {
    setCurrencyState(c);
    try { localStorage.setItem('pos-currency', c); } catch { /* not persisted */ }
  };
  const home = useHomeData(org, merchants, currency);
  const usesPos = org?.sector === 'supermarche';

  // Same query as the Stock page — usually already in the cache.
  const { data: stockItems } = useQuery({
    queryKey: ['org-stock-items', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/stock-items`)).data,
    enabled: !!org?.id,
  });
  const lowStock = ((stockItems as any[]) || []).filter((i) => i.quantity <= (i.low_stock_threshold ?? 5)).length;

  const alerts: HomeAlert[] = [];
  if (lowStock) alerts.push({ icon: AlertTriangle, tone: 'warning', to: '/dashboard/organization/stock', label: `${lowStock} produit${lowStock > 1 ? 's' : ''} en stock bas — à réapprovisionner` });
  if (home.held) alerts.push({ icon: PauseCircle, tone: 'info', to: '/dashboard/pos', label: `${home.held} ticket${home.held > 1 ? 's' : ''} en attente à la caisse` });

  const sellPath = usesPos ? '/dashboard/pos' : '/dashboard/organization/sales';
  const actions: QuickAction[] = [
    { label: 'Vendre', icon: ShoppingCart, onClick: () => navigate(sellPath), tone: 'bg-primary text-primary-foreground shadow-primary/30' },
    { label: 'Produit', icon: PackagePlus, onClick: () => navigate('/dashboard/organization/stock?ajouter=1'), tone: 'bg-emerald-500/15 text-emerald-600' },
    ...(org?.scanlinkpay_number
      ? [{ label: 'Recevoir', icon: QrCode, onClick: () => setShowQrPresent(true), tone: 'bg-sky-500/15 text-sky-600' }]
      : []),
    { label: 'Dépense', icon: MinusCircle, onClick: () => setShowAddExpense(true), tone: 'bg-rose-500/15 text-rose-600' },
  ];

  if (isLoading) {
    return (
      <div className="p-6 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (org && !org.onboarding_completed_at) {
    return <OnboardingWizard orgId={org.id} orgName={org.name} org={org} />;
  }

  if (org && org.status === 'pending') {
    return <PendingValidationScreen orgName={org.name} />;
  }

  if (org && org.status === 'rejected') {
    return <RejectedScreen orgId={org.id} orgName={org.name} org={org} reason={org.rejection_reason} />;
  }

  return (
    <div className="px-4 pt-4 pb-28 md:pb-6 lg:p-6 space-y-5 max-w-6xl mx-auto">
      <HomeHero
        firstName={user?.full_name?.split(' ')[0]}
        orgName={org?.name}
        currency={currency}
        onCurrency={setCurrency}
        today={home.today}
        yesterday={home.yesterday}
        loading={home.loading}
        onOpenTill={() => navigate(sellPath)}
      />

      <QuickActions actions={actions} />

      <AlertsList alerts={alerts} />

      <div className="space-y-5 lg:grid lg:grid-cols-2 lg:gap-5 lg:space-y-0 lg:items-start">
        <div className="space-y-5">
          <SalesChart days={home.days} currency={currency} loading={home.loading} />
          <TopProducts top={home.top} currency={currency} loading={home.loading} />
        </div>
        <div className="space-y-5">
          <RecentSales
            sales={home.recent}
            currency={currency}
            loading={home.loading}
            moreTo={usesPos ? '/dashboard/pos' : '/dashboard/organization/sales/history'}
          />
          {storesBreakdown && storesBreakdown.length > 1 && (
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="mb-2 text-sm font-semibold text-foreground">Meilleures boutiques</p>
              {storesBreakdown.map((st: any, i: number) => (
                <div key={st.merchant_id} className="flex items-center gap-3 border-b border-border py-2.5 last:border-0">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {i === 0 ? <Trophy className="h-4 w-4" /> : i + 1}
                  </div>
                  <p className="min-w-0 flex-1 truncate font-medium text-foreground">{st.merchant_name}</p>
                  <DualCurrencyStat amounts={st.volume} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <OnlinePaymentsLine amounts={stats?.net} onClick={() => navigate('/dashboard/organization/transactions')} />

      {/* Expense — behind the "Dépense" quick action instead of a form on the page */}
      {showAddExpense && (
        <FormSheet onClose={() => setShowAddExpense(false)} title="Nouvelle dépense">
          <div className="p-6 space-y-4">
            <h2 className="text-xl font-bold text-foreground">Nouvelle dépense</h2>
            <div className="space-y-2">
              <Label htmlFor="expense_amount">Montant</Label>
              <Input
                id="expense_amount"
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={newExpense.amount}
                onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })}
              />
            </div>
            <CurrencySelector value={newExpense.currency} onChange={(c) => setNewExpense({ ...newExpense, currency: c })} />
            <div className="space-y-2">
              <Label htmlFor="expense_description">Description</Label>
              <Input
                id="expense_description"
                placeholder="Achat de fournitures"
                value={newExpense.description}
                onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
              />
            </div>
            {addExpenseMutation.isError && (
              <p className="text-sm text-destructive text-center">Échec de l'enregistrement — réessayez.</p>
            )}
            <Button className="w-full" size="lg" disabled={!newExpense.amount || addExpenseMutation.isPending} onClick={() => addExpenseMutation.mutate()}>
              {addExpenseMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
              Enregistrer la dépense
            </Button>
          </div>
        </FormSheet>
      )}

      {/* Presentation mode — clean fullscreen QR to show to a client without
          exposing any dashboard data. */}
      {showQrPresent && org?.scanlinkpay_number && (
        <div
          className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center p-8"
          onClick={() => setShowQrPresent(false)}
        >
          <button
            className="absolute top-5 right-5 w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-foreground hover:bg-accent"
            onClick={() => setShowQrPresent(false)}
          >
            <X className="w-5 h-5" />
          </button>
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
            <Building2 className="w-7 h-7 text-primary" />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">{org.name}</h2>
          <p className="text-muted-foreground mb-8">Scannez ce code pour payer</p>
          {org.scanlinkpay_qr_url && (
            <img
              src={org.scanlinkpay_qr_url}
              alt="QR ScanLinkPay"
              className="w-72 h-72 sm:w-96 sm:h-96 rounded-3xl border border-border bg-white p-4"
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <div className="mt-8 flex items-center gap-3 rounded-2xl bg-secondary px-5 py-3" onClick={(e) => e.stopPropagation()}>
            <code className="font-mono text-2xl font-bold tracking-widest text-foreground">
              {org.scanlinkpay_number}
            </code>
            <Button
              variant="ghost"
              size="icon"
              onClick={async () => {
                await shareOrCopy({
                  title: 'Payez-moi via ScanLinkPay',
                  text: `Payez ${org.name} via ScanLinkPay`,
                  url: `${publicOrigin()}/pay/${org.scanlinkpay_number}`,
                });
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">ou saisissez ce numéro dans l'application</p>
        </div>
      )}
    </div>
  );
}
