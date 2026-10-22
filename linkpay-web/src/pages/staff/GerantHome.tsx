import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useHomeData } from '@/components/home/useHomeData';
import type { Currency } from '@/components/home/useHomeData';
import { HomeHero, RecentSales } from '@/components/home/HomeWidgets';
import {
  Receipt, Package, Users, Vault, ChevronRight, CalendarDays,
} from 'lucide-react';

const SHORTCUTS = [
  {
    label: 'Historique des ventes',
    sub: 'Consulter les transactions',
    icon: Receipt,
    to: '/dashboard/organization/sales/history',
    tone: 'bg-primary/10 text-primary',
  },
  {
    label: 'Stock',
    sub: 'Produits et alertes',
    icon: Package,
    to: '/dashboard/organization/stock',
    tone: 'bg-violet-500/10 text-violet-600',
  },
  {
    label: 'Équipe',
    sub: 'Vendeurs et activité',
    icon: Users,
    to: '/dashboard/organization/team',
    tone: 'bg-emerald-500/10 text-emerald-600',
  },
  {
    label: 'Caisses',
    sub: 'Encaissements et clôtures',
    icon: Vault,
    to: '/dashboard/organization/caisses',
    tone: 'bg-amber-500/10 text-amber-600',
  },
] as const;

/**
 * Home dashboard for the Gérant (store manager).
 * Shows: hero card (daily revenue) · 4 shortcut link-cards · recent sales
 * Desktop adds a "Résumé rapide" sidebar column.
 */
export default function GerantHome() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  const [currency, setCurrencyState] = useState<Currency>(() => {
    try { return localStorage.getItem('pos-currency') === 'USD' ? 'USD' : 'CDF'; } catch { return 'CDF'; }
  });
  const setCurrency = (c: Currency) => {
    setCurrencyState(c);
    try { localStorage.setItem('pos-currency', c); } catch { /* ignored */ }
  };

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
    enabled: !!user?.organization_id,
  });

  const { data: merchants } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data as { id: string; name: string }[],
    enabled: !!org?.id,
  });

  const stationId = user?.station_id || merchants?.[0]?.id;

  const homeData = useHomeData(org, merchants, currency);

  // Low-stock count — same query key as CashierHome so the cache is shared.
  const { data: stockItems } = useQuery({
    queryKey: ['pos-catalog', stationId],
    queryFn: async () => (await api.get(`/merchants/${stationId}/stock-items`)).data as any[],
    enabled: !!stationId,
  });
  const lowStockCount = (stockItems || []).filter(
    (i: any) => i.quantity <= (i.low_stock_threshold ?? 5),
  ).length;

  // Active sellers count
  const { data: teamData } = useQuery({
    queryKey: ['org-staff', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/staff`)).data,
    enabled: !!org?.id,
  });
  const staffList: any[] = Array.isArray(teamData) ? teamData : (teamData?.data ?? []);
  const activeStaff = staffList.filter(
    (m: any) => m.role === 'vendeur' || m.role === 'caissier',
  ).length;

  return (
    <div className="px-4 pt-4 pb-28 md:pb-6 lg:p-6 space-y-5 max-w-6xl mx-auto">
      {/* ── Hero card ── */}
      <HomeHero
        firstName={user?.full_name?.split(' ')[0]}
        orgName={org?.name ?? ''}
        currency={currency}
        onCurrency={setCurrency}
        today={homeData.today}
        yesterday={homeData.yesterday}
        loading={homeData.loading}
        onOpenTill={() => navigate('/dashboard/organization/sales')}
        heroLabel="Chiffre d'affaires du jour"
        storeIcon
      />

      {/* ── 2×2 shortcut cards ── */}
      <div className="grid grid-cols-2 gap-3">
        {SHORTCUTS.map(({ label, sub, icon: Icon, to, tone }) => (
          <Link
            key={label}
            to={to}
            className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-accent/50 active:scale-[0.98]"
          >
            <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${tone}`}>
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground leading-snug">{label}</p>
              <p className="text-xs text-muted-foreground leading-snug">{sub}</p>
            </div>
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </div>

      {/* ── Bottom section: activity + quick summary (desktop only) ── */}
      <div className="lg:grid lg:grid-cols-3 lg:gap-5 lg:items-start space-y-5 lg:space-y-0">
        {/* Activité récente */}
        <div className="lg:col-span-2">
          <RecentSales
            title="Activité récente"
            sales={homeData.recent}
            currency={currency}
            loading={homeData.loading}
            moreTo="/dashboard/organization/sales/history"
          />
        </div>

        {/* Résumé rapide — desktop only */}
        <div className="hidden lg:block rounded-2xl border border-border bg-card p-4">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Résumé rapide</p>
            <span className="flex items-center gap-1 rounded-lg bg-muted px-2 py-1 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" />
              Aujourd'hui
            </span>
          </div>
          <div className="divide-y divide-border">
            {[
              {
                label: 'Ventes',
                value: homeData.loading ? '—' : (homeData.today.count ?? 0),
                color: 'text-foreground',
              },
              {
                label: 'Dépenses',
                value: 0,
                color: 'text-foreground',
              },
              {
                label: 'Stock faible',
                value: lowStockCount,
                color: lowStockCount > 0 ? 'text-warning font-semibold' : 'text-foreground',
              },
              {
                label: 'Vendeurs actifs',
                value: activeStaff,
                color: 'text-foreground',
              },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className={color}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
