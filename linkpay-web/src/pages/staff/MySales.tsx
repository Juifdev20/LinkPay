import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency, cn } from '@/lib/utils';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** All the cashier's paid tickets of [from, to) — the API returns their own tickets only. */
async function fetchMine(stationId: string, from: string, to: string): Promise<any[]> {
  const all: any[] = [];
  for (let page = 1; page <= 30; page++) {
    const { data } = await api.get(`/merchants/${stationId}/pos/tickets`, { params: { status: 'paid', from, to, page, limit: 100 } });
    all.push(...(data.data || []));
    if (all.length >= (data.total || 0) || !(data.data || []).length) break;
  }
  return all;
}

/**
 * "Mes ventes" — the cashier's own sales of a month, day by day, in both
 * currencies: what they rang up, never the station's totals or margins.
 */
export default function MySalesPage() {
  const user = useAuthStore((s) => s.user);
  const [offset, setOffset] = useState(0); // 0 = this month, -1 = last month…
  const [currency, setCurrency] = useState<'CDF' | 'USD'>('CDF');

  const { from, to, label, days } = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
    const list: string[] = [];
    for (let d = new Date(start); d < end && d <= now; d.setDate(d.getDate() + 1)) list.push(dayKey(d));
    return { from: start.toISOString(), to: end.toISOString(), label: start.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }), days: list.reverse() };
  }, [offset]);

  const { data: org } = useQuery({ queryKey: ['my-organization'], queryFn: async () => (await api.get('/organizations/me')).data });
  const { data: stations } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data as { id: string; name: string }[],
    enabled: !!org?.id,
  });
  const stationId = user?.station_id || stations?.[0]?.id;

  const { data: tickets, isLoading } = useQuery({
    queryKey: ['my-sales', stationId, from],
    queryFn: () => fetchMine(stationId!, from, to),
    enabled: !!stationId,
  });

  const byDay = new Map<string, { count: number; total: number }>();
  for (const t of (tickets || []).filter((t) => t.currency === currency && t.paid_at)) {
    const k = dayKey(new Date(t.paid_at));
    const d = byDay.get(k) || { count: 0, total: 0 };
    d.count += 1;
    d.total += t.total_cents || 0;
    byDay.set(k, d);
  }
  const monthTotal = [...byDay.values()].reduce((a, d) => a + d.total, 0);
  const monthCount = [...byDay.values()].reduce((a, d) => a + d.count, 0);
  const activeDays = days.filter((d) => byDay.has(d));
  const max = Math.max(1, ...[...byDay.values()].map((d) => d.total));

  return (
    <div className="p-4 md:p-6 pb-28 md:pb-6 space-y-5 max-w-2xl mx-auto">
      <PageHeader title="Mes ventes" />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button className="rounded-full p-2 hover:bg-accent" aria-label="Mois précédent" onClick={() => setOffset((o) => o - 1)}><ChevronLeft className="h-5 w-5" /></button>
          <p className="min-w-[9rem] text-center text-sm font-semibold capitalize">{label}</p>
          <button className="rounded-full p-2 hover:bg-accent disabled:opacity-30" aria-label="Mois suivant" disabled={offset >= 0} onClick={() => setOffset((o) => Math.min(0, o + 1))}><ChevronRight className="h-5 w-5" /></button>
        </div>
        <div className="flex gap-1.5">
          {(['CDF', 'USD'] as const).map((c) => (
            <button key={c} onClick={() => setCurrency(c)} className={cn('rounded-full border px-3 py-1 text-sm font-medium', currency === c ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground')}>{c}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Total du mois</p>
          <p className="mt-1 text-lg font-bold [overflow-wrap:anywhere]">{formatCurrency(monthTotal, currency)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Tickets · jours travaillés</p>
          <p className="mt-1 text-lg font-bold">{monthCount} · {activeDays.length}</p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          {isLoading || !stationId ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : !activeDays.length ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Aucune vente en {currency} ce mois-ci.</p>
          ) : (
            <div className="divide-y divide-border">
              {activeDays.map((k) => {
                const d = byDay.get(k)!;
                return (
                  <div key={k} className="flex items-center gap-3 py-2.5 text-sm">
                    <span className="w-24 flex-shrink-0 capitalize text-muted-foreground">
                      {new Date(`${k}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                    </span>
                    <div className="h-2 flex-1 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${(d.total / max) * 100}%` }} /></div>
                    <span className="w-10 flex-shrink-0 text-right text-muted-foreground">{d.count}</span>
                    <span className="w-28 flex-shrink-0 text-right font-semibold">{formatCurrency(d.total, currency)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
