import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
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
import { Building2, Loader2, Store, Plus, TrendingUp, Receipt, QrCode, Wallet, ChevronRight, X, Copy, Check, XCircle, Trophy, Banknote, Smartphone, Package, MinusCircle, PiggyBank } from 'lucide-react';
import { shareOrCopy, publicOrigin } from '@/lib/share';

export default function OrganizationProfilePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const enterStore = useAuthStore((s) => s.enterStore);
  const [showCreateStore, setShowCreateStore] = useState(false);
  const [newStore, setNewStore] = useState({ name: '', phone: '', city: '', default_currency: 'CDF' as 'CDF' | 'USD' });
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const enterMutation = useMutation({
    mutationFn: async (merchantId: string) => {
      setEnteringId(merchantId);
      const { data } = await api.post(`/organizations/${org.id}/merchants/${merchantId}/enter`);
      return data;
    },
    onSuccess: (data) => {
      enterStore(data.merchant, data.access_token, data.refresh_token, data.organization_id);
      navigate('/dashboard');
    },
    onSettled: () => setEnteringId(null),
  });

  const createStoreMutation = useMutation({
    mutationFn: async () => (await api.post(`/organizations/${org.id}/merchants`, newStore)).data,
    onSuccess: (data) => {
      setShowCreateStore(false);
      setNewStore({ name: '', phone: '', city: '', default_currency: 'CDF' });
      queryClient.invalidateQueries({ queryKey: ['org-merchants', org.id] });
      enterMutation.mutate(data.merchant.id);
    },
  });

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
    return <OnboardingWizard orgId={org.id} orgName={org.name} />;
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Building2 className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{org?.name || 'Dashboard'}</h1>
          {org?.status && (
            <Badge variant={org.status === 'active' ? 'success' : 'warning'} className="mt-1 capitalize">
              {org.status}
            </Badge>
          )}
        </div>
      </div>

      {org?.scanlinkpay_number && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Numéro ScanLinkPay</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-4">
              Vos clients peuvent vous payer directement en scannant ce QR ou en saisissant ce numéro, sans facture préétablie.
            </p>
            {org.scanlinkpay_qr_url && (
              <div className="flex justify-center mb-4">
                <img src={org.scanlinkpay_qr_url} alt="QR ScanLinkPay" className="w-48 h-48 rounded-2xl border border-border" />
              </div>
            )}
            <div className="rounded-xl bg-secondary p-3 text-left">
              <p className="text-sm text-muted-foreground mb-1">Votre numéro</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-lg font-bold tracking-wider text-foreground">{org.scanlinkpay_number}</code>
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
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Récapitulatif</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
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
            <div className="rounded-xl border border-border p-4 space-y-3">
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
            <Button variant="outline" className="w-full" onClick={() => setShowAddExpense(true)}>
              <Plus className="mr-1 w-4 h-4" />
              Ajouter une dépense
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((c) => (
          <Card key={c.label}>
            <CardContent className="pt-5">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                <c.icon className="w-5 h-5 text-primary" />
              </div>
              {c.money ? (
                <DualCurrencyStat amounts={c.money} />
              ) : (
                <p className="text-xl font-bold text-foreground">{c.value}</p>
              )}
              <p className="text-sm text-muted-foreground">{c.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
              <TrendingUp className="w-5 h-5 text-primary" />
            </div>
            <DualCurrencyStat amounts={stats?.net} />
            <p className="text-sm text-muted-foreground">Net perçu</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center mb-3">
              <XCircle className="w-5 h-5 text-destructive" />
            </div>
            <p className="text-xl font-bold text-foreground">{stats?.failed_count || 0}</p>
            <p className="text-sm text-muted-foreground">Échecs</p>
          </CardContent>
        </Card>
      </div>

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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Boutiques</CardTitle>
          <Button size="sm" onClick={() => setShowCreateStore(true)}>
            <Plus className="mr-1 w-4 h-4" />
            Créer une boutique
          </Button>
        </CardHeader>
        <CardContent>
          {showCreateStore && (
            <div className="rounded-xl border border-border p-4 mb-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-foreground text-sm">Nouvelle boutique</p>
                <button onClick={() => setShowCreateStore(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new_store_name">Nom de la boutique</Label>
                <Input
                  id="new_store_name"
                  placeholder="Boutique Mukendi"
                  value={newStore.name}
                  onChange={(e) => setNewStore({ ...newStore, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new_store_phone">Téléphone</Label>
                <Input
                  id="new_store_phone"
                  placeholder="+243 8XX XXX XXX"
                  value={newStore.phone}
                  onChange={(e) => setNewStore({ ...newStore, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new_store_city">Ville</Label>
                <Input
                  id="new_store_city"
                  placeholder="Kinshasa"
                  value={newStore.city}
                  onChange={(e) => setNewStore({ ...newStore, city: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Devise par défaut</Label>
                <CurrencySelector value={newStore.default_currency} onChange={(c) => setNewStore({ ...newStore, default_currency: c })} />
              </div>
              <Button
                className="w-full"
                disabled={!newStore.name || createStoreMutation.isPending}
                onClick={() => createStoreMutation.mutate()}
              >
                {createStoreMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                Créer et ouvrir
              </Button>
            </div>
          )}

          {merchants?.length ? (
            <div>
              {merchants.map((m: any) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => enterMutation.mutate(m.id)}
                  disabled={enteringId === m.id}
                  className="w-full flex items-center justify-between py-3 border-b border-border last:border-0 text-left hover:bg-accent/50 transition-colors -mx-2 px-2 rounded-lg"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Store className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold truncate text-foreground">{m.name}</p>
                      <p className="text-sm text-muted-foreground">{m.city || m.default_currency}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant={m.status === 'active' ? 'success' : m.status === 'rejected' || m.status === 'suspended' ? 'error' : 'warning'} className="capitalize">
                      {m.status}
                    </Badge>
                    {enteringId === m.id ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            !showCreateStore && <p className="text-muted-foreground text-center py-6">Aucune boutique pour le moment</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
