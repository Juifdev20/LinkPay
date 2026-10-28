import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, CheckCircle2, Loader2, ShieldCheck, TriangleAlert, UserCheck, XCircle } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { receivedCents, type Currency } from '@/lib/exchange';

interface Overview {
  enabled: boolean;
  rates: { buy: number | null; sell: number | null; market: number | null; updated_at: string | null; updated_by: string | null; fresh: boolean; expires_at: string | null };
  limits: { currency: Currency; min_cents: number | null; max_cents: number | null; daily_max_cents: number | null; monthly_max_cents: number | null }[];
  stats: { gain_today_cdf_cents: number; gain_7d_cdf_cents: number; gain_total_cdf_cents: number; count_today: number; count_7d: number; volume_7d_usd_cents: number };
  history: { id: string; created_at: string; changed_by: string | null; buy_rate: number; sell_rate: number; previous_buy_rate: number | null; previous_sell_rate: number | null }[];
}

interface VerificationRow {
  user_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'revoked';
  requested_at: string;
  decided_at: string | null;
  reason: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
}

const num = (v: string): number => Number(v.replace(/\s/g, '').replace(',', '.'));
const money = (cents: number, cur: Currency = 'CDF') => formatCurrency(cents, cur).replace(/,00(?=\s)/, '');
const rateText = (v: number | null | undefined) => (v == null ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(v));
const errorOf = (err: any, fallback: string) => {
  const m = err?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : m || fallback;
};

const ROLE_LABEL: Record<string, string> = { client: 'Client', merchant: 'Marchand', enterprise: 'Patron', cashier: 'Caissier' };

/** « 1 250 » (units) from a cap in cents, blank when there is none. */
const unitsOf = (cents: number | null | undefined) => (cents == null ? '' : String(cents / 100));
const capOf = (v: string): number | null => (v.trim() === '' ? null : Math.round(num(v) * 100));

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-xs font-medium text-success">{hint}</p>}
    </div>
  );
}

/** The two prices and what they earn: the heart of the page. */
function RatesPanel({ overview }: { overview: Overview }) {
  const queryClient = useQueryClient();
  const [buy, setBuy] = useState('');
  const [sell, setSell] = useState('');
  const [market, setMarket] = useState('');
  const [margin, setMargin] = useState('1');
  const [warning, setWarning] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setBuy(overview.rates.buy != null ? String(overview.rates.buy) : '');
    setSell(overview.rates.sell != null ? String(overview.rates.sell) : '');
    setMarket(overview.rates.market != null ? String(overview.rates.market) : '');
  }, [overview.rates.buy, overview.rates.sell, overview.rates.market]);

  const b = num(buy), s = num(sell);
  const m = market.trim() ? num(market) : (b + s) / 2;
  const valid = Number.isFinite(b) && Number.isFinite(s) && b > 0 && s > 0 && b <= s && (!market.trim() || (Number.isFinite(m) && m >= b && m <= s));
  const gainBuy = valid ? m - b : 0; // CDF kept per dollar when a client gives us dollars
  const gainSell = valid ? s - m : 0; // CDF kept per dollar when a client gives us francs
  const pct = (g: number) => (m > 0 ? `${((g / m) * 100).toFixed(2).replace('.', ',')} %` : '');

  const save = useMutation({
    mutationFn: async (confirm: boolean) =>
      (await api.put('/admin/exchange/rates', { buy_rate: b, sell_rate: s, market_rate: market.trim() ? m : null, ...(confirm ? { confirm_large_change: true } : {}) })).data,
    onSuccess: (data) => {
      setWarning('');
      setError('');
      queryClient.setQueryData(['admin-exchange'], data);
    },
    onError: (err: any) => {
      if (err?.response?.data?.code === 'EXCHANGE_RATE_BIG_CHANGE') setWarning(err.response.data.message);
      else setError(errorOf(err, "Les taux n'ont pas pu être enregistrés."));
    },
  });

  // The example: what a client gets for 100 $US at the BUY price, against what the market would have given.
  const example = useMemo(() => {
    if (!valid) return null;
    const got = receivedCents('USD', 10000, { buy: b, sell: s }).to_cents;
    const atMarket = Math.floor(10000 * m);
    return { got, atMarket, gain: atMarket - got };
  }, [valid, b, s, m]);

  const helper = () => {
    const mk = num(market), mg = num(margin);
    if (!Number.isFinite(mk) || mk <= 0 || !Number.isFinite(mg) || mg < 0 || mg > 10) return;
    setBuy(String(Math.round(mk * (1 - mg / 100) * 100) / 100));
    setSell(String(Math.round(mk * (1 + mg / 100) * 100) / 100));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-bold">Les taux du jour</CardTitle>
        <p className="text-xs text-muted-foreground">Deux chiffres à saisir. Les clients voient directement ces prix, sans autre frais. Sans mise à jour pendant 24 h, le service se met en pause tout seul.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-primary">Nous achetons le dollar</p>
            <p className="mt-1 text-sm text-foreground">Le client nous <b>donne des dollars</b> et reçoit des francs.</p>
            <div className="mt-3 flex items-center gap-2 whitespace-nowrap text-sm font-semibold">
              1 $US =
              <Input inputMode="decimal" value={buy} onChange={(e) => setBuy(e.target.value)} aria-label="Prix d'achat du dollar" className="h-11 max-w-[8.5rem] text-lg font-bold" />
              CDF
            </div>
            {valid && <p className="mt-2 text-xs text-muted-foreground">Il reçoit <b className="text-foreground">{rateText(b)} CDF</b> pour 1 $US. Gain : {rateText(gainBuy)} CDF par dollar ({pct(gainBuy)}).</p>}
          </div>
          <div className="rounded-2xl border border-success/25 bg-success/5 p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-success">Nous vendons le dollar</p>
            <p className="mt-1 text-sm text-foreground">Le client nous <b>donne des francs</b> et reçoit des dollars.</p>
            <div className="mt-3 flex items-center gap-2 whitespace-nowrap text-sm font-semibold">
              1 $US =
              <Input inputMode="decimal" value={sell} onChange={(e) => setSell(e.target.value)} aria-label="Prix de vente du dollar" className="h-11 max-w-[8.5rem] text-lg font-bold" />
              CDF
            </div>
            {valid && <p className="mt-2 text-xs text-muted-foreground">Il paie <b className="text-foreground">{rateText(s)} CDF</b> pour 1 $US. Gain : {rateText(gainSell)} CDF par dollar ({pct(gainSell)}).</p>}
          </div>
        </div>

        {b > s && <p className="text-sm font-medium text-destructive">Le prix d'achat ne peut pas dépasser le prix de vente.</p>}
        {market.trim() && Number.isFinite(m) && Number.isFinite(b) && Number.isFinite(s) && b <= s && (m < b || m > s) && (
          <p className="text-sm font-medium text-destructive">Le taux du marché doit se trouver entre le prix d'achat et le prix de vente.</p>
        )}

        {valid && example && (
          <div className="rounded-2xl bg-brand-gradient px-5 py-4 text-primary-foreground">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-xs opacity-80">Notre gain</p>
                <p className="text-xl font-extrabold">≈ {rateText(Math.round(((gainBuy + gainSell) / 2) * 100) / 100)} CDF par dollar</p>
              </div>
              <p className="text-xs opacity-80">Écart total achat / vente : {rateText(s - b)} CDF</p>
            </div>
            <p className="mt-3 text-xs leading-relaxed opacity-90">
              Exemple : un client change 100 $US, il reçoit <b>{money(example.got)}</b>. Au taux du marché ({rateText(m)}) il en aurait reçu {money(example.atMarket)}.
              Notre gain : <b>{money(example.gain)}</b> (≈ {(example.gain / 100 / m).toFixed(2).replace('.', ',')} $US).
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3 border-t border-dashed border-border pt-4">
          <div className="space-y-1">
            <Label htmlFor="ex_market" className="text-xs">Taux du marché (pour mesurer le gain)</Label>
            <Input id="ex_market" inputMode="decimal" value={market} onChange={(e) => setMarket(e.target.value)} placeholder="ex. 2850" className="h-10 w-36" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ex_margin" className="text-xs">Marge (%)</Label>
            <Input id="ex_margin" inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} className="h-10 w-20" />
          </div>
          <Button type="button" variant="outline" onClick={helper} disabled={!market.trim()}>Remplir les deux taux</Button>
          <Button className="ml-auto" disabled={!valid || save.isPending} onClick={() => { setError(''); save.mutate(false); }}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Enregistrer
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Pas envie de calculer ? Saisissez le taux du marché et une marge, puis « Remplir les deux taux » : prix d'achat = marché − marge, prix de vente = marché + marge.
        </p>
        {error && <p className="text-sm font-medium text-destructive">{error}</p>}
        {save.isSuccess && !error && !warning && <p className="text-sm font-medium text-success">Taux enregistrés. Les clients voient les nouveaux prix tout de suite.</p>}
      </CardContent>

      <Dialog open={!!warning} onOpenChange={(open) => !open && setWarning('')}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><TriangleAlert className="h-5 w-5 text-warning" /> Vérifiez ces taux</DialogTitle></DialogHeader>
          <p className="text-sm text-foreground">{warning}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWarning('')}>Corriger</Button>
            <Button disabled={save.isPending} onClick={() => save.mutate(true)}>Confirmer quand même</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function LimitsPanel({ overview }: { overview: Overview }) {
  const queryClient = useQueryClient();
  const [forms, setForms] = useState<Record<string, { min: string; max: string; daily: string; monthly: string }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setForms(Object.fromEntries(overview.limits.map((l) => [l.currency, { min: unitsOf(l.min_cents), max: unitsOf(l.max_cents), daily: unitsOf(l.daily_max_cents), monthly: unitsOf(l.monthly_max_cents) }])));
  }, [overview.limits]);

  const save = useMutation({
    mutationFn: async (currency: string) => {
      const f = forms[currency];
      return (await api.put(`/admin/exchange/limits/${currency}`, { min_cents: capOf(f.min), max_cents: capOf(f.max), daily_max_cents: capOf(f.daily), monthly_max_cents: capOf(f.monthly) })).data;
    },
    onSuccess: (data, currency) => {
      setErrors((e) => ({ ...e, [currency]: '' }));
      queryClient.setQueryData(['admin-exchange'], data);
    },
    onError: (err: any, currency) => setErrors((e) => ({ ...e, [currency]: errorOf(err, "Les limites n'ont pas pu être enregistrées.") })),
  });

  const set = (c: string, patch: Partial<{ min: string; max: string; daily: string; monthly: string }>) => setForms((f) => ({ ...f, [c]: { ...f[c], ...patch } }));
  const FIELDS = [['min', 'Minimum'], ['max', 'Maximum par échange'], ['daily', 'Par jour'], ['monthly', 'Par mois']] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-bold">Limites</CardTitle>
        <p className="text-xs text-muted-foreground">Par devise donnée par le client, en unités (dollars ou francs). Vide = pas de limite. Les limites par jour et par mois se comptent par compte.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {(['USD', 'CDF'] as Currency[]).map((c) => forms[c] && (
          <div key={c} className="space-y-3">
            <p className="text-sm font-bold text-foreground">{c === 'USD' ? 'Le client donne des dollars (USD)' : 'Le client donne des francs (CDF)'}</p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {FIELDS.map(([key, label]) => (
                <div key={key} className="space-y-1">
                  <Label htmlFor={`lim_${c}_${key}`} className="text-xs">{label}</Label>
                  <Input id={`lim_${c}_${key}`} inputMode="decimal" value={forms[c][key]} onChange={(e) => set(c, { [key]: e.target.value })} placeholder="Pas de limite" />
                </div>
              ))}
            </div>
            {errors[c] && <p className="text-sm font-medium text-destructive">{errors[c]}</p>}
            <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate(c)}>
              {save.isPending && save.variables === c && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Enregistrer les limites {c}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Accounts waiting for the team's go-ahead, and those already allowed. */
function VerificationsPanel() {
  const queryClient = useQueryClient();
  const { data: rows = [], isLoading } = useQuery<VerificationRow[]>({
    queryKey: ['admin-exchange-verifications'],
    queryFn: async () => (await api.get('/admin/exchange/verifications')).data,
  });
  const [deciding, setDeciding] = useState<{ row: VerificationRow; kind: 'reject' | 'revoke' } | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const done = () => queryClient.invalidateQueries({ queryKey: ['admin-exchange-verifications'] });
  const approve = useMutation({
    mutationFn: async (userId: string) => (await api.post(`/admin/exchange/verifications/${userId}/approve`)).data,
    onSuccess: done,
    onError: (err: any) => { setError(errorOf(err, 'Action impossible.')); done(); },
  });
  const decide = useMutation({
    mutationFn: async () => (await api.post(`/admin/exchange/verifications/${deciding!.row.user_id}/${deciding!.kind}`, { reason })).data,
    onSuccess: () => { setDeciding(null); setReason(''); done(); },
    onError: (err: any) => setError(errorOf(err, 'Action impossible.')),
  });

  const pending = rows.filter((r) => r.status === 'pending');
  const approved = rows.filter((r) => r.status === 'approved');
  const who = (r: VerificationRow) => (
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-foreground">{r.full_name || r.email || 'Compte'}</p>
      <p className="truncate text-xs text-muted-foreground">
        {[r.role ? ROLE_LABEL[r.role] || r.role : null, r.phone, r.email].filter(Boolean).join(' · ')}
      </p>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-bold">
          Comptes à valider {pending.length > 0 && <Badge variant="warning">{pending.length}</Badge>}
        </CardTitle>
        <p className="text-xs text-muted-foreground">Un compte ne peut échanger qu'une fois validé. Contactez la personne, vérifiez son identité, puis validez : elle est prévenue par notification.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />}
        {error && <p className="text-sm font-medium text-destructive">{error}</p>}
        {!isLoading && pending.length === 0 && <p className="text-sm text-muted-foreground">Aucune demande en attente.</p>}
        {pending.map((r) => (
          <div key={r.user_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
            {who(r)}
            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-muted-foreground sm:inline">{formatDate(r.requested_at)}</span>
              <Button size="sm" disabled={approve.isPending} onClick={() => { setError(''); approve.mutate(r.user_id); }}>
                <CheckCircle2 className="mr-1 h-4 w-4" /> Valider
              </Button>
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => { setError(''); setReason(''); setDeciding({ row: r, kind: 'reject' }); }}>
                <XCircle className="mr-1 h-4 w-4" /> Refuser
              </Button>
            </div>
          </div>
        ))}

        {approved.length > 0 && (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Comptes validés ({approved.length})</p>
            {approved.map((r) => (
              <div key={r.user_id} className="flex items-center justify-between gap-3 py-1.5">
                {who(r)}
                <div className="flex items-center gap-2">
                  <Badge variant="success"><UserCheck className="mr-1 h-3.5 w-3.5" /> Validé</Badge>
                  <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => { setError(''); setReason(''); setDeciding({ row: r, kind: 'revoke' }); }}>Retirer</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={!!deciding} onOpenChange={(open) => !open && setDeciding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{deciding?.kind === 'reject' ? 'Refuser la demande' : "Retirer l'accès"} — {deciding?.row.full_name || deciding?.row.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="ex_reason">{deciding?.kind === 'reject' ? 'Motif (montré au client)' : 'Motif (facultatif, montré au client)'}</Label>
            <Input id="ex_reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="ex. Identité non vérifiée" />
            {error && <p className="text-sm font-medium text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>Annuler</Button>
            <Button variant="destructive" disabled={decide.isPending || (deciding?.kind === 'reject' && reason.trim().length < 3)} onClick={() => decide.mutate()}>
              {decide.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {deciding?.kind === 'reject' ? 'Refuser' : 'Retirer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function AdminExchangePage() {
  const queryClient = useQueryClient();
  const isSuper = useAuthStore((s) => s.user?.role) === 'super_admin';
  const [error, setError] = useState('');

  const { data: overview, isLoading, isError } = useQuery<Overview>({
    queryKey: ['admin-exchange'],
    queryFn: async () => (await api.get('/admin/exchange/overview')).data,
    enabled: isSuper,
  });

  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => (await api.put('/admin/exchange/service', { enabled })).data,
    onSuccess: (data) => { setError(''); queryClient.setQueryData(['admin-exchange'], data); },
    onError: (err: any) => setError(errorOf(err, "Le service n'a pas pu être modifié.")),
  });

  const market = overview?.rates.market ?? (overview?.rates.buy && overview?.rates.sell ? (overview.rates.buy + overview.rates.sell) / 2 : null);
  const approx = (cdfCents: number) => (market ? ` ≈ ${(cdfCents / 100 / market).toFixed(2).replace('.', ',')} $US` : '');

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 pb-28 md:pb-6">
      <PageHeader title="Bureau d'échange" />

      {isSuper && isLoading && <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />}
      {isSuper && isError && <p className="text-sm text-destructive">Impossible de charger le Bureau d'échange. La migration 088 est-elle appliquée sur cette base ?</p>}

      {isSuper && overview && (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="flex items-start gap-3">
                <span className={cn('mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl', overview.enabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}>
                  <ArrowLeftRight className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-semibold text-foreground">Service d'échange {overview.enabled ? 'actif' : 'fermé'}</p>
                  <p className="max-w-xl text-sm text-muted-foreground">
                    {overview.enabled
                      ? overview.rates.fresh
                        ? `Les clients validés peuvent échanger. Taux à jour jusqu'au ${overview.rates.expires_at ? formatDate(overview.rates.expires_at) : '—'}.`
                        : 'Ouvert, mais en pause : les taux ne sont pas à jour (plus de 24 h). Enregistrez les taux du jour.'
                      : "Fermé : personne ne voit le bouton. Fixez d'abord les taux du jour, puis ouvrez le service. L'échange de devises est encadré par la Banque Centrale du Congo : ouvrez-le une fois la situation légale réglée."}
                  </p>
                </div>
              </div>
              <label className="flex items-center gap-3 text-sm font-semibold text-foreground">
                {overview.enabled ? 'Ouvert' : 'Fermé'}
                <Switch checked={overview.enabled} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate(v)} aria-label="Ouvrir ou fermer le Bureau d'échange" />
              </label>
              {error && <p className="w-full text-sm font-medium text-destructive">{error}</p>}
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Gains aujourd'hui" value={money(overview.stats.gain_today_cdf_cents)} hint={`${approx(overview.stats.gain_today_cdf_cents).trim()} · ${overview.stats.count_today} échange${overview.stats.count_today > 1 ? 's' : ''}`.replace(/^ · /, '')} />
            <StatTile label="Gains sur 7 jours" value={money(overview.stats.gain_7d_cdf_cents)} hint={`${approx(overview.stats.gain_7d_cdf_cents).trim()} · ${overview.stats.count_7d} échange${overview.stats.count_7d > 1 ? 's' : ''}`.replace(/^ · /, '')} />
            <StatTile label="Volume échangé (7 j)" value={money(overview.stats.volume_7d_usd_cents, 'USD')} hint="dans les deux sens" />
            <StatTile label="Taux mis à jour" value={overview.rates.updated_at ? formatDate(overview.rates.updated_at) : 'Jamais'} hint={overview.rates.updated_by ? `par ${overview.rates.updated_by}` : undefined} />
          </div>
        </>
      )}

      <div className="space-y-6 lg:grid lg:grid-cols-5 lg:items-start lg:gap-6 lg:space-y-0">
        {isSuper && overview && (
          <div className="space-y-6 lg:col-span-3">
            <RatesPanel overview={overview} />
            <LimitsPanel overview={overview} />
          </div>
        )}
        <div className={cn('space-y-6', isSuper ? 'lg:col-span-2' : 'lg:col-span-5')}>
          <VerificationsPanel />
          {isSuper && overview && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base font-bold"><ShieldCheck className="h-4 w-4 text-muted-foreground" /> Historique des taux</CardTitle>
                <p className="text-xs text-muted-foreground">Chaque changement est gardé : qui, quand, anciens et nouveaux prix.</p>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {overview.history.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucun changement pour l'instant.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3 font-semibold">Date</th><th className="py-2 pr-3 font-semibold">Par</th><th className="py-2 pr-3 font-semibold">Achat</th><th className="py-2 font-semibold">Vente</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.history.map((h) => (
                        <tr key={h.id} className="border-b border-border last:border-0">
                          <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">{formatDate(h.created_at)}</td>
                          <td className="py-2 pr-3">{h.changed_by || '—'}</td>
                          <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{h.previous_buy_rate != null && `${rateText(h.previous_buy_rate)} → `}<b>{rateText(h.buy_rate)}</b></td>
                          <td className="whitespace-nowrap py-2 tabular-nums">{h.previous_sell_rate != null && `${rateText(h.previous_sell_rate)} → `}<b>{rateText(h.sell_rate)}</b></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
