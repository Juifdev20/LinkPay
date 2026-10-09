import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useLicense, type FeatureState } from '@/lib/license';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader } from '@/components/PageHeader';
import { PinInput } from '@/components/PinInput';
import { CurrencySelector } from '@/components/CurrencySelector';
import { Loader2, Minus, Plus, Check, Gift, Wallet } from 'lucide-react';

const MAX_DAYS = 3650;
const PRESETS = [7, 30, 90, 365];

const statusBadge = (f: FeatureState) => {
  if (f.status === 'active') return <Badge variant="success">Active · {f.days_left} j</Badge>;
  if (f.status === 'trial') return <Badge variant="secondary">Essai gratuit</Badge>;
  if (f.status === 'expired') return <Badge variant="destructive">Expirée</Badge>;
  return <Badge variant="outline">Pas de licence</Badge>;
};

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export default function LicensePage() {
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const { data: state, isLoading, orgId } = useLicense();
  const { data: wallet } = useQuery({ queryKey: ['wallet'], queryFn: async () => (await api.get('/wallet')).data });

  const [currency, setCurrency] = useState<'CDF' | 'USD'>('CDF');
  const [days, setDays] = useState(30);
  const [picked, setPicked] = useState<string[]>(() => (params.get('feature') ? [params.get('feature')!] : []));
  const [pin, setPin] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const idempotencyKey = useRef(newKey());

  const features = state?.features ?? [];
  const sellable = features.filter((f) => f.prices[currency] !== undefined);
  const allPicked = sellable.length > 0 && sellable.every((f) => picked.includes(f.key));
  const chosen = sellable.filter((f) => picked.includes(f.key));

  // Same rule as the server (which recomputes everything): choosing every feature uses the "all-in" price when the admin set one.
  const sum = chosen.reduce((n, f) => n + f.prices[currency], 0);
  const bundle = state?.bundle_prices?.[currency];
  const useBundle = allPicked && sellable.length === features.length && bundle !== undefined;
  const perDay = useBundle ? bundle! : sum;
  const total = perDay * days;
  const balance: number = wallet?.balances?.[currency] ?? 0;
  const enough = balance >= total;

  const clampDays = (n: number) => Math.min(MAX_DAYS, Math.max(1, Math.round(n) || 1));
  const toggle = (key: string) => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  const toggleAll = () => setPicked(allPicked ? [] : sellable.map((f) => f.key));

  const pay = useMutation({
    mutationFn: async () =>
      (await api.post(`/licenses/organizations/${orgId}/purchase`, { features: chosen.map((f) => f.key), all: allPicked && sellable.length === features.length, days, currency, pin }, {
        headers: { 'Idempotency-Key': idempotencyKey.current },
      })).data,
    onSuccess: (res) => {
      idempotencyKey.current = newKey();
      setPin('');
      setPicked([]);
      setDone(`${res.quote.days} jour${res.quote.days > 1 ? 's' : ''} ajouté${res.quote.days > 1 ? 's' : ''} : accès actif immédiatement.`);
      queryClient.invalidateQueries({ queryKey: ['license-state'] });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
  });
  const payError = (pay.error as any)?.response?.data?.message;

  const canPay = chosen.length > 0 && days >= 1 && perDay > 0 && enough && pin.length === 4 && !pay.isPending;
  const saved = useBundle ? sum * days - total : 0;

  const expiring = useMemo(() => features.filter((f) => f.status === 'active' && (f.days_left ?? 99) <= 7), [features]);

  if (isLoading) return <div className="p-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="p-6 pb-28 md:pb-6 space-y-6 max-w-3xl mx-auto">
      <PageHeader title="Licence" />

      {state?.trial.active && (
        <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
          <Gift className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <p><span className="font-semibold">Essai gratuit : {state.trial.days_left} jour{state.trial.days_left > 1 ? 's' : ''} restant{state.trial.days_left > 1 ? 's' : ''}.</span> Tout est utilisable jusqu'au {formatDate(state.trial.ends_at)}. Les licences achetées pendant l'essai s'ajoutent dès l'achat.</p>
        </div>
      )}

      {expiring.length > 0 && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200">
          {expiring.map((f) => `${f.name} (${f.days_left} j)`).join(', ')} : bientôt expiré. Ajoutez des jours ci-dessous pour ne pas être interrompu.
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base font-bold">Mes licences</CardTitle></CardHeader>
        <CardContent className="divide-y divide-border">
          {features.map((f) => (
            <div key={f.key} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-semibold text-sm">{f.name}</p>
                <p className="text-xs text-muted-foreground">{f.expires_at ? `${f.status === 'expired' ? 'Expirée le' : "Jusqu'au"} ${formatDate(f.expires_at)}` : f.description}</p>
              </div>
              {statusBadge(f)}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base font-bold">Acheter ou prolonger</CardTitle>
            <CurrencySelector value={currency} onChange={(c) => { setCurrency(c); setPicked([]); }} />
          </div>
          <p className="text-xs text-muted-foreground">Choisissez les fonctionnalités et le nombre de jours. Si une licence court encore, les jours s'ajoutent à la suite.</p>
        </CardHeader>
        <CardContent className="space-y-5">
          <label className="flex items-center gap-3 rounded-xl border-2 border-primary/30 bg-primary/5 p-3 cursor-pointer">
            <Checkbox checked={allPicked} onCheckedChange={toggleAll} aria-label="Toute l'application" />
            <div className="flex-1">
              <p className="font-bold text-sm">Toute l'application</p>
              <p className="text-xs text-muted-foreground">Toutes les fonctionnalités d'un coup{bundle !== undefined ? ' — tarif groupé' : ''}.</p>
            </div>
            {sellable.length > 0 && <span className="text-sm font-semibold">{formatCurrency(bundle ?? sellable.reduce((n, f) => n + f.prices[currency], 0), currency)}/j</span>}
          </label>

          <div className="space-y-2">
            {features.map((f) => {
              const price = f.prices[currency];
              const disabled = price === undefined;
              return (
                <label key={f.key} className={cn('flex items-center gap-3 rounded-xl border border-border p-3', disabled ? 'opacity-50' : 'cursor-pointer')}>
                  <Checkbox checked={picked.includes(f.key)} disabled={disabled} onCheckedChange={() => toggle(f.key)} aria-label={f.name} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{f.name}</p>
                    {f.description && <p className="text-xs text-muted-foreground">{f.description}</p>}
                  </div>
                  <span className="text-sm font-semibold whitespace-nowrap">{disabled ? 'Indisponible' : `${formatCurrency(price, currency)}/j`}</span>
                </label>
              );
            })}
          </div>

          <div className="space-y-2">
            <Label className="font-semibold">Nombre de jours</Label>
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" size="icon" aria-label="Moins de jours" onClick={() => setDays((d) => clampDays(d - 1))} disabled={days <= 1}><Minus className="w-4 h-4" /></Button>
              <Input
                inputMode="numeric"
                aria-label="Nombre de jours"
                className="text-center text-lg font-bold w-24"
                value={days}
                onChange={(e) => setDays(clampDays(parseInt(e.target.value.replace(/\D/g, ''), 10)))}
              />
              <Button type="button" variant="outline" size="icon" aria-label="Plus de jours" onClick={() => setDays((d) => clampDays(d + 1))} disabled={days >= MAX_DAYS}><Plus className="w-4 h-4" /></Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button key={p} type="button" onClick={() => setDays(p)} className={cn('px-3 py-1 rounded-full text-xs font-bold border', days === p ? 'bg-primary text-primary-foreground border-primary' : 'border-border')}>
                  {p} j
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-muted/50 p-4 space-y-1 text-sm" aria-live="polite">
            <div className="flex justify-between"><span className="text-muted-foreground">Prix par jour</span><span>{formatCurrency(perDay, currency)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Durée</span><span>{days} jour{days > 1 ? 's' : ''}</span></div>
            {saved > 0 && <div className="flex justify-between text-green-600"><span>Économie « toute l'application »</span><span>−{formatCurrency(saved, currency)}</span></div>}
            <div className="flex justify-between font-bold text-base pt-1 border-t border-border"><span>Total</span><span data-testid="total">{formatCurrency(total, currency)}</span></div>
            <div className="flex justify-between text-xs text-muted-foreground pt-1"><span className="flex items-center gap-1"><Wallet className="w-3 h-3" /> Solde du portefeuille</span><span className={cn(!enough && chosen.length > 0 && 'text-destructive font-semibold')}>{formatCurrency(balance, currency)}</span></div>
          </div>
          {!enough && chosen.length > 0 && <p className="text-sm text-destructive">Solde insuffisant : rechargez votre portefeuille ScanLinkPay pour payer.</p>}

          <div className="space-y-2">
            <Label className="font-semibold">Code PIN de transaction</Label>
            <PinInput value={pin} onChange={setPin} length={4} />
          </div>

          {payError && <p className="text-sm text-destructive font-medium">{payError}</p>}
          {done && <p className="text-sm text-green-600 font-medium flex items-center gap-2"><Check className="w-4 h-4" /> {done}</p>}

          <Button className="w-full h-12" disabled={!canPay} onClick={() => { setDone(null); pay.mutate(); }}>
            {pay.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : `Payer ${formatCurrency(total, currency)} avec mon portefeuille`}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
