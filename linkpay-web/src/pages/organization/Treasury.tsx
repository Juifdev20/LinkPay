import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Landmark, Lock, LockKeyhole, Loader2, ShieldCheck, TrendingDown, TrendingUp, Layers, Store, Wallet } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { PasswordInput } from '@/components/PasswordInput';
import { PasswordStrength, passwordScore } from '@/components/PasswordStrength';
import { Button } from '@/components/ui/button';
import { cn, formatCurrency } from '@/lib/utils';

type Currency = 'CDF' | 'USD';
type Money = { CDF: number; USD: number };
interface StationRow { merchant_id: string | null; merchant_name: string; collected: Money; expenses: Money; net: Money }
interface Overview { stations: StationRow[]; totals: { collected: Money; expenses: Money; net: Money } }

// The access token lives in memory only (never saved on the phone): closing the app locks the treasury again.
let treasuryToken: { value: string; expiresAt: number } | null = null;
const currentToken = () => (treasuryToken && treasuryToken.expiresAt > Date.now() ? treasuryToken.value : null);

const errorText = (e: any, fallback: string) => e?.response?.data?.message || fallback;

/** Whole units: a cash desk reads better without cents. */
const money = (cents: number, currency: string) => formatCurrency(cents, currency).replace(/[,.]00(?=\D*$)/, '');

/**
 * Trésorerie (the owner's general cash desk): everything the stations collected, everything spent,
 * and what is really in the cash desk (collected − spent), per currency and per station.
 * Behind its own password: created on the first entry, asked again afterwards.
 */
export default function TreasuryPage() {
  const queryClient = useQueryClient();
  const [unlocked, setUnlocked] = useState<boolean>(() => !!currentToken());
  const [currency, setCurrency] = useState<Currency>(() => {
    try { return localStorage.getItem('pos-currency') === 'USD' ? 'USD' : 'CDF'; } catch { return 'CDF'; }
  });
  const [station, setStation] = useState<string>('all'); // 'all' | merchant id | 'none' (expenses without a station)

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
  });

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery({
    queryKey: ['org-treasury-status', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/treasury/status`)).data as { is_set: boolean; locked_until: string | null },
    enabled: !!org?.id,
    staleTime: 0,
  });

  const grant = (res: { token: string; expires_in: number }) => {
    treasuryToken = { value: res.token, expiresAt: Date.now() + res.expires_in * 1000 };
    setUnlocked(true);
    queryClient.invalidateQueries({ queryKey: ['org-treasury', org?.id] });
  };
  const lock = () => {
    treasuryToken = null;
    setUnlocked(false);
    queryClient.removeQueries({ queryKey: ['org-treasury', org?.id] });
  };

  const { data: overview, isLoading: overviewLoading, error: overviewError } = useQuery({
    queryKey: ['org-treasury', org?.id],
    queryFn: async () => {
      try {
        return (await api.get(`/organizations/${org.id}/treasury`, { headers: { 'x-treasury-token': currentToken() || '' } })).data as Overview;
      } catch (e: any) {
        if (e?.response?.data?.message === 'TREASURY_LOCKED') lock();
        throw e;
      }
    },
    enabled: !!org?.id && !!status?.is_set && unlocked,
    refetchOnMount: 'always',
    retry: false,
  });

  if (!org || statusLoading) {
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const header = <PageHeader title="Trésorerie" />;

  if (!status?.is_set) {
    return (
      <div className="mx-auto max-w-md space-y-5 p-4 pb-28 md:p-6">
        {header}
        <CreatePassword orgId={org.id} onDone={(res) => { grant(res); refetchStatus(); }} />
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="mx-auto max-w-md space-y-5 p-4 pb-28 md:p-6">
        {header}
        <Unlock orgId={org.id} lockedUntil={status.locked_until} onDone={grant} onLocked={refetchStatus} />
      </div>
    );
  }

  const rows = overview?.stations || [];
  const picked = station === 'all' ? rows : rows.filter((r) => (r.merchant_id ?? 'none') === station);
  const sum = (pick: (r: StationRow) => Money) => picked.reduce((s, r) => s + pick(r)[currency], 0);
  const collected = sum((r) => r.collected);
  const spent = sum((r) => r.expenses);
  const net = collected - spent;
  const chips = [{ id: 'all', name: 'Toutes les stations', icon: Layers }, ...rows.map((r) => ({ id: r.merchant_id ?? 'none', name: r.merchant_name, icon: Store }))];

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 pb-28 md:p-6">
      {header}

      <div className="flex items-center justify-between gap-3">
        <div className="flex rounded-full bg-secondary p-0.5 text-sm font-semibold">
          {(['CDF', 'USD'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              className={cn('rounded-full px-4 py-1.5 transition-colors', currency === c ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
            >
              {c}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={lock}>
          <Lock className="mr-1.5 h-3.5 w-3.5" /> Verrouiller
        </Button>
      </div>

      {rows.length > 1 && (
        <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0" role="tablist" aria-label="Station affichée">
          <div className="flex w-max gap-2">
            {chips.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={station === c.id}
                onClick={() => setStation(c.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors',
                  station === c.id ? 'border-primary bg-primary text-primary-foreground shadow-md shadow-primary/20' : 'border-border bg-card text-foreground hover:bg-accent',
                )}
              >
                <c.icon className="h-3.5 w-3.5" />
                <span className="max-w-[16rem] whitespace-nowrap">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {overviewError ? (
        <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          {errorText(overviewError, 'Impossible de charger la trésorerie — réessayez.')}
        </p>
      ) : overviewLoading || !overview ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* Real cash: what was collected minus what was spent */}
          <div className="relative overflow-hidden rounded-3xl bg-brand-gradient p-6 text-white shadow-xl shadow-primary/25">
            <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
            <div className="relative">
              <p className="flex items-center gap-2 text-sm text-white/80"><Wallet className="h-4 w-4" /> Montant réel en caisse</p>
              <p className={cn('mt-2 break-words text-4xl font-extrabold tracking-tight', net < 0 && 'text-rose-200')}>
                {net < 0 ? '−' : ''}{money(Math.abs(net), currency)}
              </p>
              <p className="mt-2 text-xs text-white/70">
                {station === 'all' ? 'Toutes les stations' : chips.find((c) => c.id === station)?.name} · encaissé − dépensé
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><TrendingUp className="h-3.5 w-3.5 text-emerald-500" /> Total encaissé</p>
              <p className="mt-1 text-lg font-bold text-emerald-600 [overflow-wrap:anywhere] dark:text-emerald-400">{money(collected, currency)}</p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><TrendingDown className="h-3.5 w-3.5 text-rose-500" /> Total dépensé</p>
              <p className="mt-1 text-lg font-bold text-rose-500 [overflow-wrap:anywhere]">{spent > 0 ? '−' : ''}{money(spent, currency)}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {/* Computer: a table. Phone: one card per station, the full name on top and the three figures labelled below. */}
            <div className="hidden grid-cols-[minmax(0,1fr)_repeat(3,minmax(7rem,auto))] gap-4 border-b border-border bg-secondary px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
              <span>Station</span>
              <span className="text-right">Encaissé</span>
              <span className="text-right">Dépensé</span>
              <span className="text-right">Réel</span>
            </div>
            <div className="divide-y divide-border">
              {rows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Aucune station pour le moment.</p>}
              {rows.map((r) => (
                <div key={r.merchant_id ?? 'none'} className="space-y-2 px-4 py-3 md:grid md:grid-cols-[minmax(0,1fr)_repeat(3,minmax(7rem,auto))] md:items-center md:gap-4 md:space-y-0">
                  <p className="break-words text-sm font-semibold text-foreground">{r.merchant_name}</p>
                  <div className="grid grid-cols-3 gap-2 md:contents">
                    <div className="min-w-0 md:text-right">
                      <p className="text-[11px] text-muted-foreground md:hidden">Encaissé</p>
                      <p className="text-xs font-medium text-emerald-600 [overflow-wrap:anywhere] dark:text-emerald-400">{money(r.collected[currency], currency)}</p>
                    </div>
                    <div className="min-w-0 md:text-right">
                      <p className="text-[11px] text-muted-foreground md:hidden">Dépensé</p>
                      <p className="text-xs font-medium text-rose-500 [overflow-wrap:anywhere]">{money(r.expenses[currency], currency)}</p>
                    </div>
                    <div className="min-w-0 md:text-right">
                      <p className="text-[11px] text-muted-foreground md:hidden">Réel</p>
                      <p className={cn('text-sm font-bold [overflow-wrap:anywhere]', r.net[currency] < 0 ? 'text-rose-500' : 'text-foreground')}>
                        {money(r.net[currency], currency)}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Montants cumulés depuis l'ouverture : ventes payées (caisse et module Ventes) moins les dépenses enregistrées.
          </p>
        </>
      )}
    </div>
  );
}

/** First entry: choose the treasury password, typed twice, with a strength meter. */
function CreatePassword({ orgId, onDone }: { orgId: string; onDone: (res: { token: string; expires_in: number }) => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const mutation = useMutation({
    mutationFn: async () => (await api.post(`/organizations/${orgId}/treasury/password`, { password, confirm })).data,
    onSuccess: onDone,
  });
  const strong = passwordScore(password) >= 2 && password.length >= 8;
  const same = password.length > 0 && password === confirm;

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-600">
          <Landmark className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-lg font-bold text-foreground">Protégez votre trésorerie</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choisissez un mot de passe trésorerie. Il sera demandé à chaque ouverture de cet écran, en plus de votre connexion.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <PasswordInput label="Mot de passe trésorerie" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="8 caractères minimum" />
        <PasswordStrength password={password} />
      </div>
      <div className="space-y-1.5">
        <PasswordInput label="Confirmer le mot de passe" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        {confirm && !same && <p className="text-xs font-medium text-destructive">Les deux mots de passe ne sont pas identiques.</p>}
      </div>

      {mutation.isError && (
        <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          {errorText(mutation.error, 'Échec de la création — réessayez.')}
        </p>
      )}
      <Button className="w-full" size="lg" disabled={!strong || !same || mutation.isPending} onClick={() => mutation.mutate()}>
        {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
        Créer et ouvrir la trésorerie
      </Button>
      {password && !strong && <p className="text-center text-xs text-muted-foreground">Niveau « Moyen » minimum : majuscules + minuscules, ou 12 caractères.</p>}
    </div>
  );
}

/** Every following entry: the password is asked (5 tries, then locked for 15 minutes). */
function Unlock({ orgId, lockedUntil, onDone, onLocked }: {
  orgId: string;
  lockedUntil: string | null;
  onDone: (res: { token: string; expires_in: number }) => void;
  onLocked: () => void;
}) {
  const [password, setPassword] = useState('');
  const mutation = useMutation({
    mutationFn: async () => (await api.post(`/organizations/${orgId}/treasury/unlock`, { password })).data,
    onSuccess: onDone,
    onError: () => { setPassword(''); onLocked(); },
  });
  const locked = !!lockedUntil && new Date(lockedUntil) > new Date();

  return (
    <form
      className="space-y-5 rounded-2xl border border-border bg-card p-5"
      onSubmit={(e) => { e.preventDefault(); if (password && !locked) mutation.mutate(); }}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-600">
          <LockKeyhole className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-lg font-bold text-foreground">Trésorerie verrouillée</h2>
          <p className="mt-1 text-sm text-muted-foreground">Entrez votre mot de passe trésorerie pour voir la caisse générale.</p>
        </div>
      </div>
      <PasswordInput label="Mot de passe trésorerie" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus disabled={locked} />
      {locked && (
        <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          Trop de tentatives échouées. Réessayez à {new Date(lockedUntil!).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.
        </p>
      )}
      {mutation.isError && !locked && (
        <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          {errorText(mutation.error, 'Mot de passe incorrect.')}
        </p>
      )}
      <Button type="submit" className="w-full" size="lg" disabled={!password || locked || mutation.isPending}>
        {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Ouvrir la trésorerie
      </Button>
    </form>
  );
}
