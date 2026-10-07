import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, ChevronRight, ShoppingCart, type LucideIcon } from 'lucide-react';
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

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-muted ${className}`} />;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
}

// ------------------------------------------------------------------
// Hero — today's sales, the first thing an owner wants to know.
// ------------------------------------------------------------------
export function HomeHero({
  firstName,
  orgName,
  currency,
  onCurrency,
  today,
  yesterday,
  loading,
  onOpenTill,
}: {
  firstName?: string;
  orgName?: string;
  currency: Currency;
  onCurrency: (c: Currency) => void;
  today: { revenue: number; count: number | null };
  yesterday: { revenue: number };
  loading: boolean;
  onOpenTill: () => void;
}) {
  const date = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const trend = yesterday.revenue > 0 ? Math.round(((today.revenue - yesterday.revenue) / yesterday.revenue) * 100) : null;
  const noSaleYet = !loading && today.revenue === 0;

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-indigo-600 to-violet-700 p-6 text-white shadow-xl shadow-primary/25">
      {/* Soft light blobs for depth */}
      <div className="pointer-events-none absolute -top-16 -right-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
      <div className="pointer-events-none absolute -bottom-20 -left-10 h-48 w-48 rounded-full bg-violet-300/20 blur-2xl" />

      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-white/80">
              {greeting()}{firstName ? ` ${firstName}` : ''} 👋
            </p>
            <h1 className="mt-0.5 text-xl font-bold leading-tight break-words">{orgName}</h1>
            <p className="mt-0.5 text-xs capitalize text-white/70">{date}</p>
          </div>
          <div className="flex flex-shrink-0 rounded-full bg-white/15 p-0.5 text-xs font-semibold">
            {(['CDF', 'USD'] as const).map((c) => (
              <button
                key={c}
                onClick={() => onCurrency(c)}
                className={`rounded-full px-2.5 py-1 transition-colors ${currency === c ? 'bg-white text-primary' : 'text-white/80'}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <p className="text-sm text-white/80">Ventes du jour</p>
          {loading ? (
            <div className="mt-2 h-10 w-48 animate-pulse rounded-lg bg-white/20" />
          ) : noSaleYet ? (
            <div className="mt-2 space-y-3">
              <p className="text-2xl font-bold">Prêt pour votre première vente ?</p>
              <button
                onClick={onOpenTill}
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-primary shadow-lg active:scale-95 transition-transform"
              >
                <ShoppingCart className="h-4 w-4" /> Ouvrir la caisse
              </button>
            </div>
          ) : (
            <>
              <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
                <p className="text-4xl font-extrabold tracking-tight">{money(today.revenue, currency)}</p>
                {trend !== null && (
                  <span
                    className={`mb-1.5 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${trend >= 0 ? 'bg-emerald-400/25 text-emerald-50' : 'bg-rose-400/25 text-rose-50'}`}
                  >
                    {trend >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                    {trend >= 0 ? '+' : ''}{trend} % vs hier
                  </span>
                )}
              </div>
              {today.count !== null && (
                <p className="mt-2 text-sm text-white/80">
                  {today.count} vente{today.count > 1 ? 's' : ''}
                  {today.count > 0 && <> · panier moyen {money(Math.round(today.revenue / today.count), currency)}</>}
                </p>
              )}
            </>
          )}
        </div>
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
    <div className="grid grid-cols-4 gap-2">
      {actions.map((a) => (
        <button key={a.label} onClick={a.onClick} className="group flex flex-col items-center gap-1.5 rounded-2xl py-2 active:scale-95 transition-transform">
          <span className={`flex h-14 w-14 items-center justify-center rounded-2xl shadow-sm ${a.tone}`}>
            <a.icon className="h-6 w-6" />
          </span>
          <span className="text-xs font-medium text-foreground">{a.label}</span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------
// 7-day bars — plain CSS, today highlighted, tap a bar for its amount.
// ------------------------------------------------------------------
export function SalesChart({ days, currency, loading }: { days: HomeDay[]; currency: Currency; loading: boolean }) {
  const [picked, setPicked] = useState<number>(days.length - 1);
  const max = Math.max(1, ...days.map((d) => d.revenue));
  const total = days.reduce((s, d) => s + d.revenue, 0);
  const sel = days[picked] || days[days.length - 1];
  const label = (date: string) =>
    new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '');

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">7 derniers jours</p>
          <p className="text-xs text-muted-foreground">Total {money(total, currency)}</p>
        </div>
        {!loading && sel && (
          <div className="text-right">
            <p className="text-sm font-bold text-foreground">{money(sel.revenue, currency)}</p>
            <p className="text-xs capitalize text-muted-foreground">
              {new Date(`${sel.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' })}
            </p>
          </div>
        )}
      </div>
      <div className="mt-4 flex h-32 items-end gap-2">
        {days.map((d, i) => {
          const isToday = i === days.length - 1;
          const h = loading ? 20 + ((i * 37) % 60) : Math.max(4, Math.round((d.revenue / max) * 100));
          return (
            <button key={d.date} onClick={() => setPicked(i)} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
              <div
                style={{ height: `${h}%` }}
                className={`w-full rounded-lg transition-all ${loading ? 'animate-pulse bg-muted' : isToday ? 'bg-gradient-to-t from-primary to-violet-500' : i === picked ? 'bg-primary/40' : 'bg-primary/15'}`}
              />
              <span className={`text-[11px] capitalize ${isToday ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                {isToday ? 'Auj.' : label(d.date)}
              </span>
            </button>
          );
        })}
      </div>
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

export function RecentSales({ sales, currency, loading, moreTo }: { sales: HomeSale[]; currency: Currency; loading: boolean; moreTo?: string }) {
  return (
    <ListCard title="Dernières ventes" action={moreTo ? { label: 'Tout voir', to: moreTo } : undefined}>
      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : !sales.length ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Aucune vente ces 7 derniers jours.</p>
      ) : (
        <div className="divide-y divide-border">
          {sales.map((s) => (
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
              <span className="text-sm font-semibold text-foreground">{money(s.amount, currency)}</span>
            </div>
          ))}
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
