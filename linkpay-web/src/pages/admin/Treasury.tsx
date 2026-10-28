import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownToLine, Landmark, Loader2, PiggyBank, Receipt, RefreshCcw, ShieldCheck, Store, Wallet } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn, formatCurrency, formatDate } from '@/lib/utils';

type Cur = {
  currency: 'CDF' | 'USD';
  owed: { wallets: number; savings: number; pending_withdrawals: number; uncredited_payments: number; total: number };
  negative_wallets: number;
  earned: { subscriptions: number; commissions: number; withdrawal_fees: number; transfer_fees: number; pro_payments: number; exchange_gains: number; total: number };
  flexpaie_balance: { amount_cents: number; noted_at: string; note?: string | null } | null;
  available: number | null;
};

/**
 * Trésorerie (super admin, migration 079). The real money is on ScanLinkPay's FlexPaie account; part of it belongs to
 * the users (their balances, savings, withdrawals not sent yet, shop payments not credited yet). What is left is
 * ScanLinkPay's own money: that is what can be taken out of FlexPaie without touching anybody's money.
 */
export default function AdminTreasuryPage() {
  const queryClient = useQueryClient();
  const [currency, setCurrency] = useState<'CDF' | 'USD'>('CDF');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['admin-treasury'],
    queryFn: async () => (await api.get('/admin/treasury')).data as { computed_at: string; currencies: Cur[]; history: any[] },
  });
  const c = data?.currencies.find((x) => x.currency === currency);
  const money = (cents: number) => formatCurrency(cents, currency);

  const save = useMutation({
    mutationFn: async () =>
      (await api.post('/admin/treasury/flexpaie-balance', {
        currency,
        amount_cents: Math.round((parseFloat(amount.replace(/\s/g, '').replace(',', '.')) || 0) * 100),
        note: note || undefined,
      })).data,
    onSuccess: (fresh) => {
      queryClient.setQueryData(['admin-treasury'], fresh);
      setAmount('');
      setNote('');
    },
  });
  const saveError = (save.error as any)?.response?.data?.message;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 pb-28 md:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <PageHeader title="Trésorerie" />
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            L'argent réel est sur le compte marchand FlexPaie. Une partie appartient aux utilisateurs ; le reste est à ScanLinkPay
            et peut être retiré de FlexPaie sans risque.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="shrink-0">
          <RefreshCcw className={cn('mr-1.5 h-4 w-4', isFetching && 'animate-spin')} /> Actualiser
        </Button>
      </div>

      <div className="inline-flex rounded-xl bg-muted p-1">
        {(['CDF', 'USD'] as const).map((cur) => (
          <button
            key={cur}
            onClick={() => setCurrency(cur)}
            className={cn('rounded-lg px-5 py-1.5 text-sm font-semibold', currency === cur ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}
          >
            {cur}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : error || !c ? (
        <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {(error as any)?.response?.data?.message || 'Trésorerie indisponible pour le moment.'}
        </p>
      ) : (
        <>
          {/* The answer first: how much can be taken out. */}
          <section
            className={cn(
              'rounded-3xl p-6 text-white shadow-brand',
              c.available == null ? 'bg-slate-700' : c.available < 0 ? 'bg-destructive' : 'bg-brand-gradient',
            )}
          >
            <p className="text-sm font-medium text-white/80">Retirable de FlexPaie sans risque</p>
            {c.available == null ? (
              <p className="mt-2 text-lg font-semibold">Saisissez d'abord le solde de votre compte FlexPaie ci-dessous.</p>
            ) : (
              <>
                <p className="mt-1 text-4xl font-extrabold tabular-nums">{money(Math.max(0, c.available))}</p>
                {c.available < 0 && (
                  <p className="mt-2 flex items-start gap-2 text-sm font-medium">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    FlexPaie contient {money(-c.available)} de moins que ce qui est dû aux utilisateurs. Ne retirez rien et vérifiez
                    (solde saisi à jour ? paiements FlexPaie en attente ? ancien argent fictif ?).
                  </p>
                )}
              </>
            )}
            {c.flexpaie_balance && (
              <p className="mt-3 text-xs text-white/75">
                Calcul : solde FlexPaie saisi le {formatDate(c.flexpaie_balance.noted_at)} − tout ce qui est dû aux utilisateurs maintenant.
              </p>
            )}
          </section>

          <div className="space-y-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:space-y-0">
            {/* What the computation is made of. */}
            <section className="rounded-3xl border border-border bg-card p-5 shadow-soft">
              <h2 className="font-bold text-foreground">Le calcul</h2>
              <div className="mt-4 divide-y divide-border text-sm">
                <Line icon={Landmark} label="Solde du compte FlexPaie (saisi)" value={c.flexpaie_balance ? money(c.flexpaie_balance.amount_cents) : '— à saisir'} strong />
                <Line icon={Wallet} label="− Soldes des utilisateurs et entreprises" value={money(c.owed.wallets)} />
                <Line icon={PiggyBank} label="− Épargne des utilisateurs" value={money(c.owed.savings)} />
                <Line icon={ArrowDownToLine} label="− Retraits en cours (pas encore envoyés)" value={money(c.owed.pending_withdrawals)} />
                <Line icon={Store} label="− Paiements reçus, pas encore crédités aux marchands" value={money(c.owed.uncredited_payments)} />
                <Line label="= Total dû aux utilisateurs" value={money(c.owed.total)} strong />
              </div>
              {c.negative_wallets > 0 && (
                <p className="mt-4 flex items-start gap-2 rounded-xl bg-warning/10 px-3.5 py-2.5 text-sm text-foreground">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  {c.negative_wallets} portefeuille{c.negative_wallets > 1 ? 's sont' : ' est'} en négatif : anomalie à vérifier (Alertes de sécurité).
                </p>
              )}
              <p className="mt-4 text-xs text-muted-foreground">
                Les portefeuilles de test ne sont pas comptés. L'ancien argent fictif (recharges d'avant FlexPaie), s'il en reste, est compté
                comme dû : le montant retirable est donc prudent.
              </p>
            </section>

            <div className="space-y-6">
              {/* Typing the FlexPaie balance. */}
              <section className="rounded-3xl border border-border bg-card p-5 shadow-soft">
                <h2 className="font-bold text-foreground">Mettre à jour le solde FlexPaie ({currency})</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Relevez le solde dans votre tableau de bord FlexPaie et saisissez-le ici. Faites-le juste avant chaque retrait.
                </p>
                <form
                  className="mt-4 space-y-3"
                  onSubmit={(e) => { e.preventDefault(); if (amount) save.mutate(); }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="flexpaie_amount">Solde FlexPaie ({currency})</Label>
                    <Input id="flexpaie_amount" inputMode="decimal" placeholder={currency === 'CDF' ? 'ex. 12 500 000' : 'ex. 4 250'} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d\s.,]/g, ''))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="flexpaie_note">Note (facultatif)</Label>
                    <Input id="flexpaie_note" placeholder="ex. relevé du 22/10 avant retrait" value={note} onChange={(e) => setNote(e.target.value)} />
                  </div>
                  {saveError && <p className="text-sm text-destructive">{Array.isArray(saveError) ? saveError.join(' ') : saveError}</p>}
                  <Button type="submit" className="w-full" disabled={!amount || save.isPending}>
                    {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                    Enregistrer (code d'authentification demandé)
                  </Button>
                </form>
              </section>

              {/* What ScanLinkPay earned, for information. */}
              <section className="rounded-3xl border border-border bg-card p-5 shadow-soft">
                <h2 className="font-bold text-foreground">Recettes de ScanLinkPay depuis le début</h2>
                <div className="mt-4 divide-y divide-border text-sm">
                  <Line icon={Receipt} label="Abonnements des entreprises" value={money(c.earned.subscriptions)} />
                  <Line icon={Receipt} label="Commissions sur les paiements" value={money(c.earned.commissions)} />
                  <Line icon={Receipt} label="Frais de retrait" value={money(c.earned.withdrawal_fees)} />
                  <Line icon={Receipt} label="Frais de transfert" value={money(c.earned.transfer_fees)} />
                  <Line icon={Receipt} label="Mode Pro « Mes dépenses »" value={money(c.earned.pro_payments)} />
                  {c.earned.exchange_gains > 0 && <Line icon={Receipt} label="Bureau d'échange" value={money(c.earned.exchange_gains)} />}
                  <Line label="Total" value={money(c.earned.total)} strong />
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Pour information : ce qui a déjà été retiré de FlexPaie n'y est pas déduit. Le montant retirable se lit en haut.
                </p>
              </section>
            </div>
          </div>

          {!!data?.history?.length && (
            <section className="rounded-3xl border border-border bg-card p-5 shadow-soft">
              <h2 className="font-bold text-foreground">Soldes FlexPaie saisis</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr><th className="py-2 pr-3 font-medium">Date</th><th className="py-2 pr-3 font-medium">Devise</th><th className="py-2 pr-3 text-right font-medium">Solde</th><th className="py-2 font-medium">Note</th></tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.history.map((h: any, i: number) => (
                      <tr key={i}>
                        <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">{formatDate(h.noted_at)}</td>
                        <td className="py-2 pr-3">{h.currency}</td>
                        <td className="whitespace-nowrap py-2 pr-3 text-right font-semibold tabular-nums">{formatCurrency(Number(h.amount_cents), h.currency)}</td>
                        <td className="py-2 text-muted-foreground">{h.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Line({ icon: Icon, label, value, strong }: { icon?: typeof Wallet; label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex items-center gap-3 py-2.5', strong && 'font-semibold text-foreground')}>
      {Icon ? <Icon className="h-4 w-4 shrink-0 text-muted-foreground" /> : <span className="w-4" />}
      <span className={cn('flex-1', !strong && 'text-muted-foreground')}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
