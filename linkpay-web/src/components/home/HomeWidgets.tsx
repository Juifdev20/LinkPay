import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, ChevronRight, MinusCircle, ShoppingCart, type LucideIcon } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import type { Currency, HomeDay, HomeSale, HomeTop } from './useHomeData';

const METHOD_LABELS: Record<string, string> = {
  cash: 'Espèces',
  scanlinkpay: 'ScanLinkPay',
  mixed: 'Mixte',
  mobile_money: 'Mobile Money',
};

/** Whole units, no cents — big hero figures read better ("48 500 CDF"). */
const money = (cents: number, currency: string) => formatCurrency(cents, currency).replace(/[,.]00(?=\D*$)/, '');

/** Short amount (cents in) for a bar label: 180 · 1,3k · 2,5M. */
const compactAmount = (cents: number) => {
  const v = cents / 100;
  const trim = (n: number) => n.toFixed(1).replace(/\.0$/, '').replace('.', ',');
  if (v >= 1_000_000) return `${trim(v / 1_000_000)}M`;
  if (v >= 1_000) return `${trim(v / 1_000)}k`;
  return String(Math.round(v));
};

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-muted ${className}`} />;
}

// ------------------------------------------------------------------
// Hero — today's sales, the first thing an owner wants to know.
// ------------------------------------------------------------------
export function HomeHero({
  orgName,
  currency,
  onCurrency,
  today,
  yesterday,
  loading,
  onOpenTill,
  heroLabel,
  firstName,
  userRole,
  storeIcon: _storeIcon,
  expenseToday,
}: {
  firstName?: string;
  orgName?: string;
  userRole?: string;
  currency: Currency;
  onCurrency: (c: Currency) => void;
  today: { revenue: number; count: number | null };
  yesterday: { revenue: number };
  loading: boolean;
  onOpenTill: () => void;
  heroLabel?: string;
  storeIcon?: boolean;
  /** What was spent today (owner's home): shown under the sales, for the station chosen. */
  expenseToday?: number;
}) {
  const trend = yesterday.revenue > 0 ? Math.round(((today.revenue - yesterday.revenue) / yesterday.revenue) * 100) : null;
  const noSaleYet = !loading && today.revenue === 0;

  return (
    <div className="relative overflow-hidden rounded-3xl bg-brand-gradient p-5 text-primary-foreground shadow-brand">
      {/* Same SVG decoration as BalanceCard — identical card shell across all modules. */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 400 240" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="hw-wave" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.18" />
            <stop offset="1" stopColor="#7cc8ff" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <circle cx="360" cy="-10" r="120" fill="#ffffff" fillOpacity="0.08" />
        <circle cx="395" cy="40" r="70" fill="#7cc8ff" fillOpacity="0.16" />
        <path d="M0 175 C 90 135, 170 215, 260 170 S 380 120, 400 145 L 400 240 L 0 240 Z" fill="url(#hw-wave)" />
        <path d="M0 205 C 110 170, 200 240, 300 200 S 380 175, 400 190 L 400 240 L 0 240 Z" fill="#ffffff" fillOpacity="0.06" />
      </svg>

      {/* Mirrors BalanceCard layout: label/subtitle row → amount → stats */}
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-primary-foreground/90">{heroLabel ?? 'Ventes du jour'}</p>
            {orgName && <p className="mt-0.5 text-[11px] text-primary-foreground/70 truncate tracking-wide">{orgName}</p>}
            {(firstName || userRole) && (
              <p className="mt-0.5 text-[11px] text-primary-foreground/70 truncate tracking-wide">
                {[firstName, userRole].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <div className="flex flex-shrink-0 rounded-full bg-white/15 p-0.5 text-xs font-semibold">
            {(['CDF', 'USD'] as const).map((c) => (
              <button
                key={c}
                onClick={() => onCurrency(c)}
                className={`rounded-full px-2.5 py-1 transition-colors ${currency === c ? 'bg-white text-primary' : 'text-primary-foreground/80'}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="mt-3 h-9 w-44 animate-pulse rounded-lg bg-white/20" />
        ) : noSaleYet ? (
          <>
            <p className="mt-3 text-[30px] leading-tight font-extrabold tracking-tight">0 {currency}</p>
            <div className="mt-3">
              <button
                onClick={onOpenTill}
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-primary shadow-lg active:scale-95 transition-transform"
              >
                <ShoppingCart className="h-4 w-4" /> Ouvrir la caisse
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1">
              <p className="text-[30px] leading-tight font-extrabold tracking-tight">{money(today.revenue, currency)}</p>
              {trend !== null && (
                <span className={`mb-1 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${trend >= 0 ? 'bg-emerald-400/25 text-emerald-50' : 'bg-rose-400/25 text-rose-50'}`}>
                  {trend >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                  {trend >= 0 ? '+' : ''}{trend} % vs hier
                </span>
              )}
            </div>
            {today.count !== null && (
              <p className="mt-1.5 text-[11px] text-primary-foreground/70 tracking-wide">
                {today.count} vente{today.count > 1 ? 's' : ''}
                {today.count > 0 && <> · panier moyen {money(Math.round(today.revenue / today.count), currency)}</>}
              </p>
            )}
          </>
        )}
        {!loading && expenseToday !== undefined && (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-black/15 px-4 py-2.5">
            <span className="flex items-center gap-2 text-sm text-white/85">
              <MinusCircle className="h-4 w-4 text-rose-200" /> Dépenses du jour
            </span>
            <span className="text-base font-bold text-rose-100">{expenseToday > 0 ? '−' : ''}{money(expenseToday, currency)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Quick actions — the 4 things done all day long.
// ------------------------------------------------------------------
export type QuickAction = { label: string; icon: LucideIcon; onClick: () => void; tone: string };

export function QuickActions({ actions }: { actions: QuickAction[] }) {
  return (
    // Phone: round icons with their label under. Computer: compact cards side by side, icon and label on one line.
    <div className={`grid gap-2 md:gap-3 ${actions.length > 4 ? 'grid-cols-5' : 'grid-cols-4'}`}>
      {actions.map((a) => (
        <button key={a.label} onClick={a.onClick} className="group flex flex-col items-center gap-1.5 rounded-2xl py-2 active:scale-95 transition-all md:flex-row md:gap-3 md:border md:border-border md:bg-card md:px-4 md:py-3 md:shadow-soft md:hover:-translate-y-0.5 md:hover:shadow-md">
          <span className={`flex items-center justify-center rounded-2xl shadow-sm md:h-11 md:w-11 md:rounded-xl ${actions.length > 4 ? 'h-12 w-12' : 'h-14 w-14'} ${a.tone}`}>
            <a.icon className="h-6 w-6 md:h-5 md:w-5" />
          </span>
          <span className="text-xs font-medium text-foreground md:text-sm md:font-semibold">{a.label}</span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------
// Sales chart — plain CSS bars, today highlighted, tap a bar for its amount.
// Supports variable number of days (7, 14, 30): labels adapt automatically.
// ------------------------------------------------------------------
export function SalesChart({
  days,
  currency,
  loading,
  periodLabel,
  expenses,
}: {
  days: HomeDay[];
  currency: Currency;
  loading: boolean;
  periodLabel?: string;
  /** Spent per day (same days as `days`): drawn as a red curve over the bars (owner's home). */
  expenses?: HomeDay[];
}) {
  const [picked, setPicked] = useState<number>(days.length - 1);
  const safePicked = Math.min(picked, days.length - 1);
  const spent = (i: number) => expenses?.[i]?.revenue ?? 0;
  const max = Math.max(1, ...days.map((d) => d.revenue), ...(expenses || []).map((d) => d.revenue));
  const total = days.reduce((s, d) => s + d.revenue, 0);
  const totalSpent = (expenses || []).reduce((s, d) => s + d.revenue, 0);
  const sel = days[safePicked] || days[days.length - 1];
  const manyBars = days.length > 14;
  const label = (date: string) =>
    new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '');

  // Plot geometry (px): the chart is 128 px high, the day label takes the bottom 14 px, bars use at most 96 px.
  const PLOT = 114;
  const BAR_MAX = 96;
  const x = (i: number) => ((i + 0.5) / days.length) * 100;
  const yPct = (cents: number) => 100 - (((cents / max) * BAR_MAX) / PLOT) * 100;
  const curve = expenses && !loading ? days.map((_, i) => `${x(i)},${yPct(spent(i))}`).join(' ') : '';

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {expenses ? `Entrées / sorties · ${periodLabel ?? '7 jours'}` : (periodLabel ?? '7 derniers jours')}
          </p>
          <p className="text-xs text-muted-foreground">
            {expenses ? (
              <>Entrées {money(total, currency)} · <span className="font-semibold text-rose-500">Sorties {money(totalSpent, currency)}</span></>
            ) : (
              <>Total {money(total, currency)}</>
            )}
          </p>
        </div>
        {!loading && sel && (
          <div className="text-right">
            <p className="text-sm font-bold text-foreground">{money(sel.revenue, currency)}</p>
            {expenses && <p className="text-xs font-semibold text-rose-500">−{money(spent(safePicked), currency)}</p>}
            <p className="text-xs capitalize text-muted-foreground">
              {new Date(`${sel.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' })}
            </p>
          </div>
        )}
      </div>
      <div className="relative mt-4 h-32">
        <div className="flex h-full items-end">
          {days.map((d, i) => {
            const isToday = i === days.length - 1;
            // Bars use at most 75% of the height: the amount is written above each one.
            const h = loading ? 20 + ((i * 37) % 55) : Math.max(4, Math.round((d.revenue / max) * 75));
            // For many bars: only show label for today and every 7th bar
            const showLabel = !manyBars || isToday || i % 7 === 0;
            return (
              <button key={d.date} onClick={() => setPicked(i)} className="flex h-full flex-1 flex-col items-center justify-end gap-1 px-[2px]">
                {!loading && !manyBars && d.revenue > 0 && (
                  <span className="text-[10px] font-semibold leading-none text-foreground/80">{compactAmount(d.revenue)}</span>
                )}
                <div
                  style={{ height: `${h}%` }}
                  className={`w-full rounded-md transition-all ${loading ? 'animate-pulse bg-muted' : isToday ? 'bg-gradient-to-t from-primary to-sky-500' : i === safePicked ? 'bg-primary/70' : 'bg-primary/40'}`}
                />
                <span className={`text-[10px] capitalize leading-none ${isToday ? 'font-semibold text-foreground' : 'text-muted-foreground'} ${!showLabel ? 'invisible' : ''}`}>
                  {isToday ? 'Auj.' : label(d.date)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Red curve of what was spent, over the bars (same scale). */}
        {expenses && !loading && (
          <div className="pointer-events-none absolute inset-x-0 top-0" style={{ bottom: 14 }}>
            <svg className="h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              <polyline points={curve} fill="none" stroke="rgb(244 63 94)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </svg>
            {days.map((d, i) => (
              <span key={d.date} className="absolute" style={{ left: `${x(i)}%`, top: `${yPct(spent(i))}%` }}>
                <span className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-rose-500" />
                {!manyBars && spent(i) > 0 && (
                  <span className="absolute -translate-x-1/2 -translate-y-[170%] whitespace-nowrap rounded bg-card/85 px-0.5 text-[10px] font-bold leading-none text-rose-500">
                    {compactAmount(spent(i))}
                  </span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
      {expenses && (
        <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-primary/60" /> Entrées</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-rose-500" /> Sorties (dépenses)</span>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Alerts — only what needs attention; nothing rendered when all is fine.
// ------------------------------------------------------------------
export type HomeAlert = { icon: LucideIcon; label: string; to: string; tone: 'warning' | 'info' };

export function AlertsList({ alerts }: { alerts: HomeAlert[] }) {
  if (!alerts.length) return null;
  return (
    <div className="space-y-2">
      {alerts.map((a) => (
        <Link
          key={a.label}
          to={a.to}
          className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors ${a.tone === 'warning' ? 'border-warning/30 bg-warning/10 hover:bg-warning/15' : 'border-primary/20 bg-primary/5 hover:bg-primary/10'}`}
        >
          <a.icon className={`h-5 w-5 flex-shrink-0 ${a.tone === 'warning' ? 'text-warning' : 'text-primary'}`} />
          <span className="flex-1 text-sm font-medium text-foreground">{a.label}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------
// Lists
// ------------------------------------------------------------------
function ListCard({ title, action, children }: { title: string; action?: { label: string; to: string }; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {action && (
          <Link to={action.to} className="text-xs font-medium text-primary hover:underline">
            {action.label}
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

export function TopProducts({ top, currency, loading }: { top: HomeTop[]; currency: Currency; loading: boolean }) {
  const medals = ['bg-amber-400/20 text-amber-600', 'bg-slate-400/20 text-slate-600', 'bg-orange-400/20 text-orange-700'];
  return (
    <ListCard title="Meilleures ventes · 7 jours">
      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : !top.length ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Vos produits les plus vendus apparaîtront ici.</p>
      ) : (
        <div className="divide-y divide-border">
          {top.map((p, i) => (
            <div key={p.name} className="flex items-center gap-3 py-2.5">
              <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${medals[i] || 'bg-muted text-muted-foreground'}`}>
                {i + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{p.name}</span>
              <span className="text-xs text-muted-foreground">{p.qty} ×</span>
              <span className="w-24 text-right text-sm font-semibold text-foreground">{money(p.revenue, currency)}</span>
            </div>
          ))}
        </div>
      )}
    </ListCard>
  );
}

export function RecentSales({
  sales,
  currency,
  loading,
  moreTo,
  title,
}: {
  sales: HomeSale[];
  currency: Currency;
  loading: boolean;
  moreTo?: string;
  title?: string;
}) {
  return (
    <ListCard title={title ?? 'Dernières ventes'} action={moreTo ? { label: 'Tout voir', to: moreTo } : undefined}>
      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : !sales.length ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Aucune vente sur cette période.</p>
      ) : (
        <div className="divide-y divide-border">
          {sales.map((s) => {
            // Use the sale's own currency if available, otherwise fall back to the global toggle
            const saleCurrency = (s.currency as Currency) || currency;
            return (
              <div key={s.id} className="flex items-center gap-3 py-2.5">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-success/10 text-success">
                  <ShoppingCart className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{s.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.at ? new Date(s.at).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                    {s.method ? ` · ${METHOD_LABELS[s.method] || s.method}` : ''}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold text-foreground">{money(s.amount, saleCurrency)}</p>
                  {s.currency && s.currency !== currency && (
                    <p className="text-[10px] text-muted-foreground">{s.currency}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ListCard>
  );
}

/** Discreet line for online ScanLinkPay payments (no longer the headline). */
export function OnlinePaymentsLine({ amounts, onClick }: { amounts?: Record<string, number>; onClick: () => void }) {
  const parts = Object.entries(amounts || {})
    .filter(([, v]) => v)
    .map(([c, v]) => money(v, c));
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left hover:bg-accent/50">
      <span className="flex-1 text-sm text-muted-foreground">
        Paiements ScanLinkPay en ligne : <span className="font-semibold text-foreground">{parts.join(' · ') || '0'}</span>
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}
