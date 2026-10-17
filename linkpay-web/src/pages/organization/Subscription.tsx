import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useSubscription } from '@/lib/subscription';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/PageHeader';
import { PinInput } from '@/components/PinInput';
import { CurrencySelector } from '@/components/CurrencySelector';
import { Loader2, Minus, Plus, Check, Gift, Wallet, CheckCircle2 } from 'lucide-react';

const MAX_MONTHS = 24;
const PRESETS = [1, 3, 6, 12];
const INCLUDED = ['Caisse (point de vente)', 'Ventes et factures', 'Stock et approvisionnement', 'Inventaire', 'Statistiques', "Journal d'activité", 'Employés et rôles'];

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const monthsLabel = (n: number) => `${n} mois`;

export default function SubscriptionPage() {
  const queryClient = useQueryClient();
  const { data: state, isLoading, orgId } = useSubscription();
  const { data: wallet } = useQuery({ queryKey: ['wallet'], queryFn: async () => (await api.get('/wallet')).data });

  const [currency, setCurrency] = useState<'CDF' | 'USD'>('CDF');
  const [months, setMonths] = useState(1);
  const [pin, setPin] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const idempotencyKey = useRef(newKey());

  const price = state?.prices?.[currency];
  const total = (price ?? 0) * months;
  const balance: number = wallet?.balances?.[currency] ?? 0;
  const enough = balance >= total;
  const clamp = (n: number) => Math.min(MAX_MONTHS, Math.max(1, Math.round(n) || 1));

  const pay = useMutation({
    mutationFn: async () =>
      (await api.post(`/subscriptions/organizations/${orgId}/subscribe`, { months, currency, pin }, { headers: { 'Idempotency-Key': idempotencyKey.current } })).data,
    onSuccess: (res) => {
      idempotencyKey.current = newKey();
      setPin('');
      setDone(`${monthsLabel(res.quote.months)} ajouté${res.quote.months > 1 ? 's' : ''} : accès actif immédiatement.`);
      queryClient.invalidateQueries({ queryKey: ['subscription-state'] });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
  });
  const payError = (pay.error as any)?.response?.data?.message;
  const canPay = !!price && enough && pin.length === 4 && !pay.isPending;

  if (isLoading) return <div className="p-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  const status = state?.status;
  const expiringSoon = status === 'active' && (state?.days_left ?? 99) <= 7;

  return (
    <div className="p-6 pb-28 md:pb-6 space-y-6 max-w-3xl mx-auto">
      <PageHeader title="Abonnement" />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base font-bold">Mon abonnement</CardTitle>
            {status === 'active' && <Badge variant="success">Actif · {state?.days_left} j</Badge>}
            {status === 'trial' && <Badge variant="secondary">Essai gratuit</Badge>}
            {status === 'expired' && <Badge variant="destructive">Expiré</Badge>}
            {status === 'none' && <Badge variant="outline">Pas d'abonnement</Badge>}
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {status === 'active' && <p>Actif jusqu'au <span className="font-semibold">{formatDate(state!.expires_at!)}</span>.</p>}
          {status === 'trial' && (
            <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
              <Gift className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <p><span className="font-semibold">Essai gratuit : {state!.trial.days_left} jour{state!.trial.days_left > 1 ? 's' : ''} restant{state!.trial.days_left > 1 ? 's' : ''}.</span> Tout est utilisable jusqu'au {formatDate(state!.trial.ends_at)}.</p>
            </div>
          )}
          {status === 'expired' && <p className="text-destructive font-medium">Expiré le {formatDate(state!.expires_at!)}. Payez un mois ou plus : l'accès reprend aussitôt.</p>}
          {status === 'none' && <p className="text-destructive font-medium">Votre essai gratuit est terminé. Abonnez-vous pour continuer.</p>}
          {expiringSoon && <p role="alert" className="text-amber-700 dark:text-amber-300 font-medium">Votre abonnement expire bientôt : ajoutez des mois ci-dessous pour ne pas être interrompu.</p>}
          <ul className="grid sm:grid-cols-2 gap-1.5 pt-1">
            {INCLUDED.map((f) => (
              <li key={f} className="flex items-center gap-2 text-muted-foreground"><CheckCircle2 className="w-4 h-4 text-primary shrink-0" /> {f}</li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Les paiements de vos clients, votre portefeuille et vos retraits ne dépendent jamais de l'abonnement.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base font-bold">{status === 'active' ? 'Prolonger' : "S'abonner"}</CardTitle>
            <CurrencySelector value={currency} onChange={setCurrency} />
          </div>
          <p className="text-xs text-muted-foreground">Un seul prix, tout est inclus. {status === 'active' ? 'Les mois s\'ajoutent à la suite de votre abonnement en cours.' : "L'accès reprend dès le paiement."}</p>
        </CardHeader>
        <CardContent className="space-y-5">
          {price === undefined ? (
            <p className="text-sm text-muted-foreground">L'abonnement n'est pas encore en vente en {currency}. Essayez une autre devise.</p>
          ) : (
            <>
              <div className="text-center">
                <p className="text-3xl font-bold" data-testid="month-price">{formatCurrency(price, currency)}</p>
                <p className="text-xs text-muted-foreground">par mois, tout inclus</p>
              </div>

              <div className="space-y-2">
                <Label className="font-semibold">Nombre de mois</Label>
                <div className="flex items-center gap-3">
                  <Button type="button" variant="outline" size="icon" aria-label="Moins de mois" onClick={() => setMonths((m) => clamp(m - 1))} disabled={months <= 1}><Minus className="w-4 h-4" /></Button>
                  <Input
                    inputMode="numeric"
                    aria-label="Nombre de mois"
                    className="text-center text-lg font-bold w-24"
                    value={months}
                    onChange={(e) => setMonths(clamp(parseInt(e.target.value.replace(/\D/g, ''), 10)))}
                  />
                  <Button type="button" variant="outline" size="icon" aria-label="Plus de mois" onClick={() => setMonths((m) => clamp(m + 1))} disabled={months >= MAX_MONTHS}><Plus className="w-4 h-4" /></Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button key={p} type="button" onClick={() => setMonths(p)} className={cn('px-3 py-1 rounded-full text-xs font-bold border', months === p ? 'bg-primary text-primary-foreground border-primary' : 'border-border')}>
                      {monthsLabel(p)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl bg-muted/50 p-4 space-y-1 text-sm" aria-live="polite">
                <div className="flex justify-between"><span className="text-muted-foreground">Durée</span><span>{monthsLabel(months)}</span></div>
                <div className="flex justify-between font-bold text-base pt-1 border-t border-border"><span>Total</span><span data-testid="total">{formatCurrency(total, currency)}</span></div>
                <div className="flex justify-between text-xs text-muted-foreground pt-1"><span className="flex items-center gap-1"><Wallet className="w-3 h-3" /> Solde du portefeuille</span><span className={cn(!enough && 'text-destructive font-semibold')}>{formatCurrency(balance, currency)}</span></div>
              </div>
              {!enough && <p className="text-sm text-destructive">Solde insuffisant : rechargez votre portefeuille ScanLinkPay pour payer.</p>}

              <div className="space-y-2">
                <Label className="font-semibold">Code PIN de transaction</Label>
                <PinInput value={pin} onChange={setPin} length={4} title="Confirmer le paiement" message={payError || undefined} />
              </div>

              {payError && <p className="text-sm text-destructive font-medium">{payError}</p>}
              {done && <p className="text-sm text-green-600 font-medium flex items-center gap-2"><Check className="w-4 h-4" /> {done}</p>}

              <Button className="w-full h-12" disabled={!canPay} onClick={() => { setDone(null); pay.mutate(); }}>
                {pay.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : `Payer ${formatCurrency(total, currency)} avec mon portefeuille`}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
