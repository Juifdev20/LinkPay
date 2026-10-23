import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, FileDown, Users } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useStationScope, resolveStation } from '@/lib/station-scope';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatCurrency, cn } from '@/lib/utils';
import { formatPercent } from '@/lib/margin';

type Money = Record<string, number>;
type Seller = {
  user_id: string;
  name: string;
  sales_count: number;
  till_tickets: number;
  module_sales: number;
  units: number;
  revenue: Money;
  margin: Money;
  revenue_with_cost: Money;
};

/** YYYY-MM-DD of a local date. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const frDate = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });

/** Every currency of an amount map, one per line ("12 000,00 CDF" / "45,00 $US"). */
function Amounts({ money, className }: { money: Money; className?: string }) {
  const entries = Object.entries(money).filter(([, v]) => v);
  if (!entries.length) return <span className={cn('text-muted-foreground', className)}>—</span>;
  return (
    <span className={className}>
      {entries.map(([cur, v]) => (
        <span key={cur} className="block whitespace-nowrap">{formatCurrency(v, cur)}</span>
      ))}
    </span>
  );
}

/** The margin per currency, with its share of the revenue it was computed on. */
function Margins({ seller }: { seller: Pick<Seller, 'margin' | 'revenue_with_cost'> }) {
  const entries = Object.entries(seller.margin);
  if (!entries.length) return <span className="text-muted-foreground">—</span>;
  return (
    <span>
      {entries.map(([cur, v]) => {
        const base = seller.revenue_with_cost[cur] || 0;
        return (
          <span key={cur} className={cn('block whitespace-nowrap', v < 0 && 'text-destructive')}>
            {formatCurrency(v, cur)}
            {base > 0 && <span className="text-[11px] text-muted-foreground"> · {formatPercent(Math.round((v / base) * 1000) / 10)}</span>}
          </span>
        );
      })}
    </span>
  );
}

/**
 * « Rapport des vendeurs » (DECISIONS.md 23/10, A3): between a start and an end date chosen freely, what each seller
 * or cashier sold — the till (supermarket) and the Ventes (electronics) together, so it works for every sector. The
 * owner picks a station or all of them; a manager or an accountant sees their own station.
 */
export default function SellerReportPage() {
  const user = useAuthStore((s) => s.user);
  const isOwner = user?.role === 'enterprise' || !!user?.acting_as_org_id;
  const today = ymd(new Date());
  const [start, setStart] = useState(() => ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [end, setEnd] = useState(today);

  const { data: org } = useQuery({ queryKey: ['my-organization'], queryFn: async () => (await api.get('/organizations/me')).data });
  const { data: stations } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data as { id: string; name: string }[],
    enabled: !!org?.id && isOwner,
  });
  const scope = useStationScope();
  const [ownerPick, setOwnerPick] = useState<string | null | undefined>(undefined);
  const stationId = isOwner ? (ownerPick !== undefined ? resolveStation(ownerPick, stations) : resolveStation(scope.stationId, stations)) : null;

  const valid = !!start && !!end && start <= end;
  // [start 00:00, the day after end 00:00) in local time: the end date is included.
  const period = useMemo(() => {
    if (!valid) return null;
    const from = new Date(`${start}T00:00:00`);
    const to = new Date(`${end}T00:00:00`);
    to.setDate(to.getDate() + 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [start, end, valid]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['seller-report', org?.id, stationId, period],
    queryFn: async () => (await api.get(`/organizations/${org.id}/reports/sellers`, { params: { ...period, merchant_id: stationId || undefined } })).data,
    enabled: !!org?.id && !!period,
  });
  const sellers: Seller[] = data?.sellers || [];

  const presets = [
    { label: "Aujourd'hui", start: today, end: today },
    { label: '7 derniers jours', start: ymd(new Date(Date.now() - 6 * 86400000)), end: today },
    { label: 'Ce mois', start: ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), end: today },
    {
      label: 'Mois dernier',
      start: ymd(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)),
      end: ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 0)),
    },
  ];

  const exportCsv = () => {
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const curs = [...new Set(sellers.flatMap((s) => Object.keys(s.revenue)))].sort();
    const head = ['Vendeur', 'Ventes', 'Tickets caisse', 'Ventes module', 'Articles', ...curs.flatMap((c) => [`CA ${c}`, `Marge ${c}`])];
    const rows = sellers.map((s) => [esc(s.name), s.sales_count, s.till_tickets, s.module_sales, s.units, ...curs.flatMap((c) => [(s.revenue[c] || 0) / 100, (s.margin[c] || 0) / 100])].join(';'));
    const title = `Rapport des vendeurs;${esc(org?.name)};${esc(data?.station || (isOwner ? 'Toutes les stations' : ''))};du ${start} au ${end}`;
    const blob = new Blob(['﻿' + [title, '', head.join(';'), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rapport-vendeurs-${start}-au-${end}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="p-4 md:p-6 pb-28 md:pb-6 space-y-5 max-w-3xl lg:max-w-6xl mx-auto">
      <PageHeader title="Rapport des vendeurs" />
      <p className="-mt-3 text-sm text-muted-foreground">Ce que chaque vendeur et caissier a vendu entre deux dates (caisse et ventes).</p>

      {isOwner && stations && stations.length > 1 && (
        <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <div className="flex w-max gap-2">
            {[{ id: null as string | null, name: 'Toutes les stations' }, ...stations].map((s) => (
              <button
                key={s.id ?? 'all'}
                onClick={() => { setOwnerPick(s.id); scope.setStation(s.id); }}
                className={cn('rounded-full border px-3 py-1.5 text-sm font-medium', stationId === s.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground')}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <div className="space-y-1.5">
              <Label htmlFor="seller-start">Date de début</Label>
              <Input id="seller-start" type="date" value={start} max={end || today} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="seller-end">Date de fin</Label>
              <Input id="seller-end" type="date" value={end} min={start} max={today} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.label}
                onClick={() => { setStart(p.start); setEnd(p.end); }}
                className={cn('rounded-full border px-3 py-1 text-xs font-medium', start === p.start && end === p.end ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground')}
              >
                {p.label}
              </button>
            ))}
          </div>
          {!valid && <p className="text-sm text-destructive">La date de fin doit être après la date de début.</p>}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : isError ? (
        <p className="text-sm text-destructive text-center py-8">{(error as any)?.response?.data?.message || 'Rapport indisponible — réessayez.'}</p>
      ) : !sellers.length ? (
        valid && <EmptyState icon={Users} title="Aucune vente sur cette période" text={`Du ${frDate(start)} au ${frDate(end)}.`} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Ventes</p><p className="text-xl font-bold">{data.totals.sales_count}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Articles vendus</p><p className="text-xl font-bold">{data.totals.units}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Chiffre d'affaires</p><Amounts money={data.totals.revenue} className="text-base font-bold" /></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Marge</p><span className="text-base font-bold"><Margins seller={data.totals} /></span></CardContent></Card>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">Vendeur</th>
                  <th className="px-3 py-2.5 text-right font-medium">Ventes</th>
                  <th className="hidden sm:table-cell px-3 py-2.5 text-right font-medium">Articles</th>
                  <th className="px-3 py-2.5 text-right font-medium whitespace-nowrap">Chiffre d'affaires</th>
                  <th className="px-3 py-2.5 text-right font-medium">Marge</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sellers.map((s) => (
                  <tr key={s.user_id}>
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-foreground">{s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[s.till_tickets ? `${s.till_tickets} à la caisse` : '', s.module_sales ? `${s.module_sales} en ventes` : ''].filter(Boolean).join(' · ')}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold">{s.sales_count}</td>
                    <td className="hidden sm:table-cell px-3 py-2.5 text-right text-muted-foreground">{s.units}</td>
                    <td className="px-3 py-2.5 text-right font-semibold"><Amounts money={s.revenue} /></td>
                    <td className="px-3 py-2.5 text-right"><Margins seller={s} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Du {frDate(start)} au {frDate(end)}, ventes payées seulement. La marge ne compte que les articles dont le prix d'achat est renseigné
            (le % est calculé sur ces articles).{data.truncated && ' Période très chargée : seules les 20 000 premières ventes sont comptées, réduisez la période.'}
          </p>
          <div className="flex justify-end">
            <Button variant="outline" onClick={exportCsv}>
              <FileDown className="mr-2 w-4 h-4" />
              Exporter (CSV)
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
