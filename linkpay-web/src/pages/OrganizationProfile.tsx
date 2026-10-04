import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CurrencySelector } from '@/components/CurrencySelector';
import { DualCurrencyStat } from '@/components/DualCurrencyStat';
import { TransactionItem } from '@/components/TransactionItem';
import OnboardingWizard from '@/pages/organization/OnboardingWizard';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { Building2, Loader2, Plus, TrendingUp, Receipt, QrCode, Wallet, X, Copy, Check, XCircle, Trophy, Banknote, Smartphone, Package, MinusCircle, PiggyBank, Clock, AlertTriangle } from 'lucide-react';
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

  const { data: recentTransactions } = useQuery({
    queryKey: ['org-recent-transactions', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/recent-transactions`)).data,
    enabled: !!org?.id,
  });

  const { data: expensesSummary } = useQuery({
    queryKey: ['org-expenses-summary', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/expenses-summary`)).data,
    enabled: !!org?.id,
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
  useRealtimeInvalidate('transactions', undefined, [['org-stats', org?.id], ['org-stores-breakdown', org?.id], ['org-recent-transactions', org?.id]], !!org?.id);

  // "Espèces" and "Articles vendus" have no data source yet (no caisse, no
  // stock/ventes module) — shown as honest placeholders rather than fake
  // numbers, filled in automatically once those tranches land.
  const cashReceived = { CDF: 0, USD: 0 };
  const electronicReceived = stats?.volume || { CDF: 0, USD: 0 };
  const expenses = expensesSummary || { CDF: 0, USD: 0 };
  const netCashReconciliation = {
    CDF: electronicReceived.CDF + cashReceived.CDF - expenses.CDF,
    USD: electronicReceived.USD + cashReceived.USD - expenses.USD,
  };

  const recapCards = [
    { label: 'Perçu électronique', money: electronicReceived, icon: Smartphone },
    { label: 'Perçu en espèces', money: cashReceived, icon: Banknote, note: 'Bientôt disponible — via la Caisse' },
    { label: 'Articles vendus', value: '—', icon: Package, note: 'Bientôt disponible — via Stock & Ventes' },
    { label: 'Dépenses', money: expenses, icon: MinusCircle },
    { label: 'Montant réel encaissé', money: netCashReconciliation, icon: PiggyBank },
  ];

  const statCards = [
    { label: 'Transactions', value: String(stats?.total_transactions || 0), icon: Receipt },
    { label: "Aujourd'hui", value: String(stats?.today_transactions || 0), icon: QrCode },
    { label: 'En attente', money: stats?.pending, icon: Wallet },
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
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-6 h-6 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground truncate">{org?.name || 'Dashboard'}</h1>
            {org?.status && (
              <Badge variant={org.status === 'active' ? 'success' : 'warning'} className="mt-1 capitalize">
                {org.status}
              </Badge>
            )}
          </div>
        </div>
        {org?.scanlinkpay_number && (
          <Button variant="outline" className="flex-shrink-0" onClick={() => setShowQrPresent(true)}>
            <QrCode className="mr-2 w-4 h-4" />
            Afficher le QR
          </Button>
        )}
      </div>

      {/* KPI strip — activity at a glance, full width on desktop */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {statCards.map((c) => (
          <Card key={c.label}>
            <CardContent className="pt-4 pb-4">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center mb-2">
                <c.icon className="w-4 h-4 text-primary" />
              </div>
              {c.money ? (
                <DualCurrencyStat amounts={c.money} />
              ) : (
                <p className="text-xl font-bold text-foreground">{c.value}</p>
              )}
              <p className="text-xs text-muted-foreground">{c.label}</p>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center mb-2">
              <TrendingUp className="w-4 h-4 text-primary" />
            </div>
            <DualCurrencyStat amounts={stats?.net} />
            <p className="text-xs text-muted-foreground">Net perçu</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="w-9 h-9 rounded-xl bg-destructive/10 flex items-center justify-center mb-2">
              <XCircle className="w-4 h-4 text-destructive" />
            </div>
            <p className="text-xl font-bold text-foreground">{stats?.failed_count || 0}</p>
            <p className="text-xs text-muted-foreground">Échecs</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Récapitulatif</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-4">
            {recapCards.map((c) => (
              <div key={c.label} className="rounded-xl border border-border p-4">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                  <c.icon className="w-4 h-4 text-primary" />
                </div>
                {c.money ? <DualCurrencyStat amounts={c.money} /> : <p className="text-xl font-bold text-foreground">{c.value}</p>}
                <p className="text-sm text-muted-foreground">{c.label}</p>
                {c.note && <p className="text-xs text-muted-foreground/70 mt-0.5">{c.note}</p>}
              </div>
            ))}
          </div>

          {showAddExpense ? (
            <div className="rounded-xl border border-border p-4 space-y-3 max-w-md">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-foreground text-sm">Nouvelle dépense</p>
                <button onClick={() => setShowAddExpense(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
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
              <Button
                className="w-full"
                disabled={!newExpense.amount || addExpenseMutation.isPending}
                onClick={() => addExpenseMutation.mutate()}
              >
                {addExpenseMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                Enregistrer la dépense
              </Button>
            </div>
          ) : (
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setShowAddExpense(true)}>
              <Plus className="mr-1 w-4 h-4" />
              Ajouter une dépense
            </Button>
          )}
        </CardContent>
      </Card>

      {storesBreakdown && storesBreakdown.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Meilleures boutiques</CardTitle>
          </CardHeader>
          <CardContent>
            {storesBreakdown.map((s: any, i: number) => (
              <div key={s.merchant_id} className="flex items-center gap-3 py-3 border-b border-border last:border-0">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-sm font-bold text-primary">
                  {i === 0 ? <Trophy className="w-4 h-4" /> : i + 1}
                </div>
                <p className="font-semibold text-foreground truncate flex-1 min-w-0">{s.merchant_name}</p>
                <DualCurrencyStat amounts={s.volume} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Activity feed — full width, at the bottom of the page */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transactions récentes</CardTitle>
        </CardHeader>
        <CardContent>
          {recentTransactions?.length ? (
            recentTransactions.map((t: any) => (
              <TransactionItem
                key={t.id}
                name={t.merchant?.name || 'Boutique'}
                amountCents={t.amount_cents}
                currency={t.currency}
                status={t.status}
                date={t.created_at}
                type="in"
              />
            ))
          ) : (
            <p className="text-muted-foreground text-center py-6">Aucune transaction pour le moment</p>
          )}
        </CardContent>
      </Card>

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
