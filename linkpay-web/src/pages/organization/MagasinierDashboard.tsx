import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { formatCurrency } from '@/lib/utils';
import { getCategoryLabel, getCategoryIcon } from '@/lib/stock-categories';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Boxes, AlertTriangle, PackagePlus, PackageMinus, PackageX, Clock,
  Plus, ClipboardList, RefreshCw, ChevronRight,
  Loader2, TrendingDown, ShoppingCart, SlidersHorizontal,
} from 'lucide-react';

// ── palette pour le donut chart (cohérente avec la charte) ───────────────────
const CHART_COLORS = ['#1338fe', '#10b981', '#f59e0b', '#15b8fe', '#0a1270', '#ec4899', '#64748b'];

// ── helpers ───────────────────────────────────────────────────────────────────

function firstPrenom(fullName?: string | null) {
  if (!fullName) return '';
  return fullName.split(' ')[0];
}

function groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
  return arr.reduce<Record<string, T[]>>((acc, item) => {
    const k = String(item[key] ?? 'autre');
    (acc[k] ??= []).push(item);
    return acc;
  }, {});
}

function formatActivityTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  const isYest = d.toDateString() === yest.toDateString();
  const t = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return t;
  if (isYest) return `Hier, ${t}`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function formatDayLabel(dateStr: string, totalDays: number) {
  const d = new Date(dateStr + 'T00:00:00');
  if (totalDays <= 10) {
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }
  // Pour 30 j+, on n'affiche que le jour du mois
  return String(d.getDate());
}

type Period = '7j' | '30j' | 'mois' | 'custom';

const PERIOD_LABELS: Record<Period, string> = {
  '7j':    '7 derniers jours',
  '30j':   '30 derniers jours',
  'mois':  'Mois en cours',
  'custom': 'Période personnalisée',
};

/** Calcule la plage de dates (YYYY-MM-DD) selon la période choisie */
function periodRange(period: Period, customFrom = '', customTo = ''): { from: string; to: string } {
  if (period === 'custom' && customFrom && customTo) {
    return { from: customFrom, to: customTo };
  }
  const to = new Date();
  const from = new Date();
  if (period === '7j') {
    from.setDate(from.getDate() - 6);
  } else if (period === '30j') {
    from.setDate(from.getDate() - 29);
  } else {
    from.setDate(1); // 1er du mois en cours
  }
  from.setHours(0, 0, 0, 0);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

const ACTIVITY_CONFIG: Record<string, { label: string; Icon: any; bg: string; color: string }> = {
  in:         { label: 'Réception validée',      Icon: PackagePlus,       bg: 'bg-emerald-500/10',  color: 'text-emerald-600'  },
  out:        { label: 'Sortie enregistrée',    Icon: PackageMinus,      bg: 'bg-amber-500/10',    color: 'text-amber-600'    },
  sale:       { label: 'Vente enregistrée',     Icon: ShoppingCart,      bg: 'bg-primary/10',      color: 'text-primary'      },
  adjustment: { label: 'Ajustement de stock',   Icon: SlidersHorizontal, bg: 'bg-muted',           color: 'text-muted-foreground' },
  new_item:   { label: 'Nouvel article ajouté', Icon: PackagePlus,       bg: 'bg-emerald-500/10',  color: 'text-emerald-600'  },
  inventory:  { label: 'Inventaire en cours',   Icon: ClipboardList,     bg: 'bg-sky-500/10',      color: 'text-sky-600'      },
};

// ── donut chart CSS conic-gradient ────────────────────────────────────────────
function DonutChart({ segments }: { segments: { label: string; pct: number; count: number; color: string }[] }) {
  let cum = 0;
  const gradient = segments
    .map(({ pct, color }) => {
      const from = cum;
      cum += pct;
      return `${color} ${from}% ${cum}%`;
    })
    .join(', ');

  const total = segments.reduce((s, x) => s + x.count, 0);

  return (
    <div className="flex items-center gap-4">
      {/* Donut */}
      <div className="relative flex-shrink-0 w-28 h-28">
        <div
          className="w-full h-full rounded-full"
          style={{ background: `conic-gradient(${gradient})` }}
        />
        {/* Hole */}
        <div className="absolute inset-[22%] rounded-full bg-card flex flex-col items-center justify-center">
          <p className="text-sm font-bold text-foreground leading-tight">{total.toLocaleString('fr')}</p>
          <p className="text-[9px] text-muted-foreground leading-tight">Articles</p>
        </div>
      </div>

      {/* Legend */}
      <div className="flex-1 space-y-1.5 min-w-0">
        {segments.map(({ label, pct, count, color }) => (
          <div key={label} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
            <span className="text-xs text-foreground truncate flex-1">{label}</span>
            <span className="text-xs text-muted-foreground flex-shrink-0">{pct}%</span>
            <span className="text-xs font-semibold text-foreground flex-shrink-0 w-8 text-right">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── bar chart SVG ─────────────────────────────────────────────────────────────
function MovementsBarChart({ daily }: { daily: { date: string; receptions: number; sorties: number }[] }) {
  const n = daily.length || 1;
  const maxVal = Math.max(...daily.flatMap((d) => [d.receptions, d.sorties]), 1);
  const ceiling = Math.ceil(maxVal / 10) * 10 || 10;

  const W = 300;
  const H = 90;
  const PAD_LEFT = 24;
  const PAD_BOTTOM = 18;
  const chartW = W - PAD_LEFT;
  const chartH = H - PAD_BOTTOM;

  const dayW = chartW / n;
  // Barres plus fines quand il y a beaucoup de jours
  const barW = Math.max(3, Math.min(10, dayW * 0.35));
  const gap = Math.min(2, barW * 0.4);

  const y = (val: number) => chartH - (val / ceiling) * chartH;
  const barH = (val: number) => Math.max(0, (val / ceiling) * chartH);

  const yLabels = [ceiling, Math.round(ceiling * 0.5), 0];

  // Afficher une étiquette tous les N jours pour ne pas saturer l'axe X
  const labelEvery = n <= 10 ? 1 : n <= 20 ? 3 : 5;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ height: 130 }}
      aria-hidden
    >
      {/* Y-axis grid lines + labels */}
      {yLabels.map((v) => (
        <g key={v}>
          <line
            x1={PAD_LEFT}
            x2={W}
            y1={y(v)}
            y2={y(v)}
            className="stroke-border"
            strokeWidth={0.5}
            strokeDasharray={v === 0 ? undefined : '2 2'}
          />
          <text
            x={PAD_LEFT - 2}
            y={y(v) + 3}
            textAnchor="end"
            fontSize={6}
            className="fill-muted-foreground"
          >
            {v}
          </text>
        </g>
      ))}

      {/* Bars + date labels */}
      {daily.map((day, i) => {
        const slotX = PAD_LEFT + i * dayW;
        const pairW = barW * 2 + gap;
        const barX = slotX + (dayW - pairW) / 2;
        const showLabel = i % labelEvery === 0 || i === n - 1;
        return (
          <g key={day.date}>
            {/* Réceptions — primary blue */}
            <rect x={barX} y={y(day.receptions)} width={barW} height={barH(day.receptions)} rx={2} fill="#1338fe" />
            {/* Sorties — emerald */}
            <rect x={barX + barW + gap} y={y(day.sorties)} width={barW} height={barH(day.sorties)} rx={2} fill="#10b981" />
            {/* Date label */}
            {showLabel && (
              <text x={slotX + dayW / 2} y={H - 2} textAnchor="middle" fontSize={5.5} className="fill-muted-foreground">
                {formatDayLabel(day.date, n)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── composant principal ───────────────────────────────────────────────────────

export default function MagasinierDashboard() {
  const user = useAuthStore((s) => s.user);
  const [period, setPeriod] = useState<Period>('7j');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const { from: fromDate, to: toDate } = useMemo(
    () => periodRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  );

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
  });

  const { data: merchants, isLoading: merchantsLoading } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data,
    enabled: !!org?.id,
  });

  // For a magasinier, the backend auto-scopes /merchants to their own station only.
  // Use station_id if present in the cached session, otherwise fall back to merchants[0].id
  // (resolved once the merchants query returns).
  const lockedMerchantId: string | null = user?.role === 'magasinier'
    ? (user?.station_id ?? (merchants as any[])?.[0]?.id ?? null)
    : null;

  const { data: items, isLoading } = useQuery({
    queryKey: ['org-stock-items', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/stock-items`)).data,
    enabled: !!org?.id,
  });

  const { data: activity } = useQuery({
    queryKey: ['org-stock-recent-activity', org?.id, fromDate, toDate],
    queryFn: async () =>
      (await api.get(`/organizations/${org.id}/stock-recent-activity`, { params: { from: fromDate, to: toDate } })).data,
    enabled: !!org?.id,
  });

  // Réceptions en attente — backend auto-scope au station du magasinier
  const { data: pendingRestock } = useQuery({
    queryKey: ['org-restock-pending', org?.id],
    queryFn: async () =>
      (await api.get(`/organizations/${org.id}/restock-requests`, { params: { status: 'pending' } })).data,
    enabled: !!org?.id,
  });

  // Inventaires en cours (uniquement si merchant connu)
  const { data: activeInventoryCounts } = useQuery({
    queryKey: ['merchant-inventory-active', lockedMerchantId],
    queryFn: async () =>
      (await api.get(`/merchants/${lockedMerchantId}/inventory-counts`, { params: { status: 'counting' } })).data,
    enabled: !!lockedMerchantId,
  });

  // ── stats depuis les items ────────────────────────────────────────────────
  // Filter to the magasinier's own station if applicable
  const allItems: any[] = (items ?? []).filter((i: any) =>
    !lockedMerchantId || i.merchant_id === lockedMerchantId
  );
  const totalItems  = allItems.length;
  const totalUnits  = allItems.reduce((s: number, i: any) => s + (i.quantity ?? 0), 0);
  const lowStock    = allItems.filter((i: any) => i.quantity > 0 && i.quantity <= i.low_stock_threshold);
  const ruptures    = allItems.filter((i: any) => i.quantity === 0);
  const alertCount  = lowStock.length + ruptures.length;

  // Valeur du stock par devise — aucune devise n'est hardcodée
  const stockByCurrency = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const i of allItems) {
      const cur: string = i.currency || 'CDF';
      const val = (i.quantity ?? 0) * (i.unit_price_cents ?? 0);
      acc[cur] = (acc[cur] ?? 0) + val;
    }
    return acc;
  }, [allItems]);

  // Entrées du jour : nouveaux articles créés aujourd'hui (createItem n'enregistre
  // pas de mouvement — on lit directly created_at depuis la liste d'articles)
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayNewItems = allItems.filter((i: any) => i.created_at?.slice(0, 10) === todayStr);
  const todayArticlesIn = todayNewItems.length;
  const todayUnitsIn    = todayNewItems.reduce((s: number, i: any) => s + (i.quantity ?? 0), 0);

  // Sorties du jour (depuis les mouvements du jour dans l'API)
  const daily: { date: string; receptions: number; sorties: number }[] = activity?.daily ?? [];
  const todayEntry   = daily[daily.length - 1];
  const todaySorties = todayEntry?.sorties ?? 0;

  // Donut chart — catégories triées par unités décroissant
  const byCategory = groupBy(allItems, 'category');
  const categoryEntries = Object.entries(byCategory)
    .map(([cat, catItems]) => ({
      cat,
      units: (catItems as any[]).reduce((s: number, i: any) => s + (i.quantity ?? 0), 0),
      count: (catItems as any[]).length,
    }))
    .sort((a, b) => b.units - a.units);

  const othersThreshold = 5;
  const mainCats   = categoryEntries.slice(0, othersThreshold);
  const otherCount = categoryEntries.slice(othersThreshold).reduce((s, e) => s + e.count, 0);

  const donutSegments = [
    ...mainCats.map((e, i) => ({
      label: getCategoryLabel(e.cat),
      count: e.count,
      pct: totalItems > 0 ? Math.round((e.count / totalItems) * 100) : 0,
      color: CHART_COLORS[i % CHART_COLORS.length],
    })),
    ...(otherCount > 0
      ? [{ label: 'Autres', count: otherCount, pct: totalItems > 0 ? Math.round((otherCount / totalItems) * 100) : 0, color: CHART_COLORS[CHART_COLORS.length - 1] }]
      : []),
  ];

  // Alertes fusionnées : ruptures → stock bas → réceptions en attente, max 5
  type AlertItem = { id: string; type: 'rupture' | 'low_stock' | 'pending_restock'; title: string; subtitle: string; time?: string };
  const alertItems: AlertItem[] = [
    ...ruptures.map((i: any) => ({
      id: i.id,
      type: 'rupture' as const,
      title: i.name,
      subtitle: 'Stock à 0 unité',
      time: i.updated_at,
    })),
    ...lowStock.map((i: any) => ({
      id: i.id,
      type: 'low_stock' as const,
      title: i.name,
      subtitle: `Il ne reste que ${i.quantity} unités (seuil : ${i.low_stock_threshold})`,
      time: i.updated_at,
    })),
    ...(Array.isArray(pendingRestock) ? pendingRestock : ((pendingRestock as any)?.data ?? [])).map((r: any) => ({
      id: r.id,
      type: 'pending_restock' as const,
      title: `Réception en attente`,
      subtitle: r.note || 'Bon de réception en attente',
      time: r.created_at,
    })),
  ].slice(0, 5);

  // Activités fusionnées : mouvements + inventaires en cours, triés par date
  // The endpoint may return a paginated wrapper { data: [...] } or a plain array.
  const inventoryList: any[] = Array.isArray(activeInventoryCounts)
    ? activeInventoryCounts
    : ((activeInventoryCounts as any)?.data ?? []);
  const inventoryActivities = inventoryList.map((inv: any) => ({
    id: inv.id,
    type: 'inventory',
    quantity_delta: 0,
    item_name: inv.scope_category ? getCategoryLabel(inv.scope_category) : 'Inventaire total',
    created_at: inv.created_at,
  }));
  // Belt-and-suspenders: filter movements to this station in case the backend
  // returns org-wide data (e.g. owner account used as test, no staff entry).
  const recentMovements = ((activity?.recent ?? []) as any[]).filter((act: any) =>
    !lockedMerchantId || !act.merchant_id || act.merchant_id === lockedMerchantId
  );
  const recentActivities: any[] = [
    ...recentMovements,
    ...inventoryActivities,
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 10);

  // Produits à surveiller
  const watchItems = [...allItems]
    .filter((i: any) => i.quantity <= i.low_stock_threshold)
    .sort((a: any, b: any) => (a.quantity / Math.max(a.low_stock_threshold, 1)) - (b.quantity / Math.max(b.low_stock_threshold, 1)))
    .slice(0, 6);

  // Répartition par magasin — masquée pour le magasinier (1 seule station)
  const byMerchant = !lockedMerchantId && merchants?.length > 1 ? groupBy(allItems, 'merchant_id') : null;

  // Block render until the station is resolved — without lockedMerchantId the
  // frontend filter is a no-op and the magasinier would see all stations.
  if (user?.role === 'magasinier' && !lockedMerchantId && merchantsLoading) {
    return (
      <div className="flex justify-center items-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isLoading && !allItems.length) {
    return (
      <div className="flex justify-center items-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const prenom = firstPrenom(user?.full_name);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">

      {/* En-tête */}
      <div>
        <h1 className="text-xl font-bold text-foreground">
          {prenom ? `Bonjour ${prenom} 👋` : 'Bonjour 👋'}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Voici un aperçu de l'activité de votre magasin aujourd'hui.
        </p>
      </div>

      {/* ── KPI cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Articles en stock */}
        <Card className="p-3.5 shadow-card">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center mb-2.5">
            <Boxes className="w-[18px] h-[18px] text-primary" />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Articles en stock</p>
          <p className="mt-1 text-[15px] font-bold text-foreground">{totalItems.toLocaleString('fr')}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{totalUnits.toLocaleString('fr')} unités</p>
        </Card>

        {/* Entrées du jour */}
        <Card className="p-3.5 shadow-card">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center mb-2.5">
            <PackagePlus className="w-[18px] h-[18px] text-emerald-600" />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Entrées du jour</p>
          <p className="mt-1 text-[15px] font-bold text-foreground">{todayArticlesIn}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            article{todayArticlesIn !== 1 ? 's' : ''} · {todayUnitsIn} unité{todayUnitsIn !== 1 ? 's' : ''}
          </p>
        </Card>

        {/* Sorties du jour */}
        <Card className="p-3.5 shadow-card">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center mb-2.5">
            <TrendingDown className="w-[18px] h-[18px] text-amber-600" />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sorties du jour</p>
          <p className="mt-1 text-[15px] font-bold text-foreground">{todaySorties}</p>
          <p className="text-xs text-muted-foreground mt-0.5">sorties / ventes</p>
        </Card>

        {/* Alertes de stock */}
        <Card className={cn('p-3.5 shadow-card', alertCount > 0 && 'border-destructive/30')}>
          <div className="w-9 h-9 rounded-xl bg-destructive/10 flex items-center justify-center mb-2.5">
            <AlertTriangle className="w-[18px] h-[18px] text-destructive" />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Alertes de stock</p>
          <p className={cn('mt-1 text-[15px] font-bold', alertCount > 0 ? 'text-destructive' : 'text-foreground')}>
            {alertCount}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">articles sous le seuil</p>
        </Card>
      </div>

      {/* ── Ligne 2 : Graphique + Alertes + Activités ─────────────────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1fr_280px]">

        {/* Mouvements de stock — bar chart avec sélecteur de période */}
        <Card className="p-4 shadow-card">
          <div className="flex items-start justify-between mb-3 gap-2 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Mouvements de stock</h2>
              <p className="text-[10px] text-muted-foreground">{PERIOD_LABELS[period]}</p>
            </div>
            {/* Sélecteur de période */}
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              <div className="flex rounded-lg border border-border overflow-hidden text-[10px] font-semibold">
                {(['7j', '30j', 'mois', 'custom'] as Period[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={cn(
                      'px-2.5 py-1 transition-colors',
                      period === p
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {p === 'mois' ? 'Mois' : p === 'custom' ? 'Période' : p.toUpperCase()}
                  </button>
                ))}
              </div>
              {period === 'custom' && (
                <div className="flex items-center gap-1.5 text-[10px]">
                  <input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="rounded-lg border border-border bg-background text-foreground px-1.5 py-0.5 text-[10px]"
                  />
                  <span className="text-muted-foreground">→</span>
                  <input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="rounded-lg border border-border bg-background text-foreground px-1.5 py-0.5 text-[10px]"
                  />
                </div>
              )}
            </div>
          </div>
          {/* Légende */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-2">
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#1338fe]" />Réceptions</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#10b981]" />Sorties</span>
          </div>
          {daily.length > 0 ? (
            <MovementsBarChart daily={daily} />
          ) : (
            <div className="h-28 flex items-center justify-center">
              <p className="text-xs text-muted-foreground">Aucun mouvement sur cette période.</p>
            </div>
          )}
        </Card>

        {/* Alertes récentes */}
        <Card className="p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              Alertes récentes
            </h2>
            <Link
              to="/dashboard/organization/stock"
              className="text-xs text-primary font-medium flex items-center gap-0.5 hover:underline"
            >
              Voir tout <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {alertItems.length > 0 ? (
            <div className="space-y-2">
              {alertItems.map((alert) => {
                const isRupture = alert.type === 'rupture';
                const isLowStock = alert.type === 'low_stock';
                const Icon = isRupture ? PackageX : isLowStock ? AlertTriangle : Clock;
                const bg = isRupture ? 'bg-destructive/5' : isLowStock ? 'bg-amber-500/5' : 'bg-primary/5';
                const iconBg = isRupture ? 'bg-destructive/10' : isLowStock ? 'bg-amber-500/10' : 'bg-primary/10';
                const iconColor = isRupture ? 'text-destructive' : isLowStock ? 'text-amber-600' : 'text-primary';
                return (
                  <div key={alert.id + alert.type} className={cn('flex items-start gap-3 rounded-xl px-3 py-2', bg)}>
                    <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5', iconBg)}>
                      <Icon className={cn('w-3.5 h-3.5', iconColor)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{alert.title}</p>
                      <p className="text-[10px] text-muted-foreground">{alert.subtitle}</p>
                    </div>
                    {alert.time && (
                      <span className="text-[10px] text-muted-foreground flex-shrink-0 mt-0.5">
                        {formatActivityTime(alert.time)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-8">Aucune alerte de stock.</p>
          )}
        </Card>

        {/* Dernières activités */}
        <Card className="p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">Dernières activités</h2>
            <Link
              to="/dashboard/organization/stock"
              className="text-xs text-primary font-medium flex items-center gap-0.5 hover:underline"
            >
              Voir tout <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {recentActivities.length > 0 ? (
            <div className="space-y-2.5">
              {recentActivities.map((act: any) => {
                const cfg = ACTIVITY_CONFIG[act.type] ?? ACTIVITY_CONFIG['adjustment'];
                const { Icon } = cfg;
                const qty = Math.abs(act.quantity_delta ?? 0);
                return (
                  <div key={act.id} className="flex items-start gap-2.5">
                    <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5', cfg.bg)}>
                      <Icon className={cn('w-3.5 h-3.5', cfg.color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground leading-tight truncate">{cfg.label}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {act.reason
                          ? act.reason
                          : `${act.item_name ?? ''}${qty > 0 ? ` · ${act.type === 'out' || act.type === 'sale' ? '-' : '+'}${qty} unité${qty > 1 ? 's' : ''}` : ''}`
                        }
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0 mt-0.5">
                      {formatActivityTime(act.created_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-8">Aucune activité récente.</p>
          )}
        </Card>
      </div>

      {/* ── Ligne 3 : Donut + Produits à surveiller + Valeur + Répartition ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr_280px]">

        {/* Stock par catégorie — donut */}
        <Card className="p-4 shadow-card">
          <h2 className="text-sm font-semibold text-foreground mb-4">Stock par catégorie</h2>
          {donutSegments.length > 0 ? (
            <DonutChart segments={donutSegments} />
          ) : (
            <p className="text-xs text-muted-foreground text-center py-8">Aucun article en stock.</p>
          )}
        </Card>

        {/* Produits à surveiller */}
        <Card className="p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Produits à surveiller
            </h2>
            <Link
              to="/dashboard/organization/stock"
              className="text-xs text-primary font-medium flex items-center gap-0.5 hover:underline"
            >
              Voir tout <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {watchItems.length > 0 ? (
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-xs min-w-[380px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left font-semibold text-muted-foreground pb-2 pr-3">Article</th>
                    <th className="text-left font-semibold text-muted-foreground pb-2 pr-3">Catégorie</th>
                    <th className="text-right font-semibold text-muted-foreground pb-2 pr-3">Stock actuel</th>
                    <th className="text-right font-semibold text-muted-foreground pb-2 pr-3">Seuil minimum</th>
                    <th className="text-right font-semibold text-muted-foreground pb-2">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {watchItems.map((item: any) => {
                    const isRupture = item.quantity === 0;
                    const Icon = getCategoryIcon(item.category);
                    return (
                      <tr key={item.id} className="border-b border-border last:border-0">
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                              <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                            </div>
                            <span className="font-medium text-foreground max-w-[120px] truncate block">{item.name}</span>
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">{getCategoryLabel(item.category)}</td>
                        <td className={cn('py-2 pr-3 text-right font-semibold', isRupture ? 'text-destructive' : 'text-amber-600')}>
                          {item.quantity}
                        </td>
                        <td className="py-2 pr-3 text-right text-muted-foreground">{item.low_stock_threshold}</td>
                        <td className="py-2 text-right">
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[10px]',
                              isRupture
                                ? 'border-destructive/40 text-destructive bg-destructive/5'
                                : 'border-amber-500/40 text-amber-600 bg-amber-500/5',
                            )}
                          >
                            {isRupture ? '↓ Rupture' : '↓ Faible'}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-8">Tous les articles sont au-dessus du seuil minimum.</p>
          )}
        </Card>

        {/* Colonne droite : valeur du stock + répartition + actions rapides */}
        <div className="space-y-4">

          {/* Valeur du stock — une ligne par devise, aucune devise hardcodée */}
          <Card className="p-4 shadow-card">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <Boxes className="w-3.5 h-3.5 text-primary" />
              </div>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Valeur du stock</h2>
            </div>
            {Object.entries(stockByCurrency).length > 0 ? (
              <div className="space-y-0.5">
                {Object.entries(stockByCurrency).map(([cur, cents]) => (
                  <p key={cur} className="text-xl font-bold text-foreground [overflow-wrap:anywhere]">
                    {formatCurrency(cents as number, cur)}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-xl font-bold text-foreground">—</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {totalItems} article{totalItems !== 1 ? 's' : ''} · {totalUnits} unité{totalUnits !== 1 ? 's' : ''}
            </p>
          </Card>

          {/* Répartition par magasin */}
          {byMerchant && merchants && (
            <Card className="p-4 shadow-card">
              <h2 className="text-sm font-semibold text-foreground mb-3">Répartition par magasin</h2>
              <div className="space-y-2.5">
                {(merchants as any[]).map((m: any) => {
                  const mItems: any[] = byMerchant[m.id] ?? [];
                  const mUnits = mItems.reduce((s: number, i: any) => s + (i.quantity ?? 0), 0);
                  const pct = totalUnits > 0 ? Math.round((mUnits / totalUnits) * 100) : 0;
                  return (
                    <div key={m.id}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-foreground truncate pr-2 max-w-[130px]">{m.name}</span>
                        <span className="text-muted-foreground flex-shrink-0">{pct}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-accent overflow-hidden">
                        <div className="h-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Actions rapides */}
          <Card className="p-4 shadow-card">
            <h2 className="text-sm font-semibold text-foreground mb-2.5">Actions rapides</h2>
            <div className="space-y-1.5">
              {[
                { to: '/dashboard/organization/stock?ajouter=1', Icon: Plus,         label: 'Nouvelle réception' },
                { to: '/dashboard/organization/stock',           Icon: Boxes,        label: 'Voir tout le stock' },
                { to: '/dashboard/organization/inventory',       Icon: ClipboardList,label: 'Lancer un inventaire' },
                { to: '/dashboard/organization/restock',         Icon: RefreshCw,    label: 'Réapprovisionnement' },
              ].map(({ to, Icon, label }) => (
                <Link
                  key={to}
                  to={to}
                  className="flex items-center gap-2.5 rounded-xl border border-border px-3 py-2 hover:bg-accent transition-colors"
                >
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <span className="text-xs font-medium text-foreground">{label}</span>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
