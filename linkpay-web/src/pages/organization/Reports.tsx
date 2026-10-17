import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useStationScope, resolveStation } from '@/lib/station-scope';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCurrency, cn } from '@/lib/utils';
import { buildStationReportPdf, buildOrganizationReportPdf, deliverPdf, METHOD_LABELS } from '@/lib/report-pdf';
import { Loader2, FileText, FileDown, AlertTriangle, Receipt, Users, Vault, Ban, Trophy, PackageX } from 'lucide-react';

type Preset = 'today' | 'yesterday' | '7d' | 'month' | 'lastmonth' | 'day';

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: "Aujourd'hui" },
  { key: 'yesterday', label: 'Hier' },
  { key: '7d', label: '7 jours' },
  { key: 'month', label: 'Ce mois' },
  { key: 'lastmonth', label: 'Mois dernier' },
  { key: 'day', label: 'Date précise' },
];

/** [from, to) of a preset, in local time. */
function rangeOf(preset: Preset, day: string): { from: string; to: string; label: string } {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const today = start(new Date());
  const iso = (a: Date, b: Date, label: string) => ({ from: a.toISOString(), to: b.toISOString(), label });
  switch (preset) {
    case 'yesterday': return iso(addDays(today, -1), today, 'Hier');
    case '7d': return iso(addDays(today, -6), addDays(today, 1), '7 derniers jours');
    case 'month': return iso(new Date(today.getFullYear(), today.getMonth(), 1), addDays(today, 1), today.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }));
    case 'lastmonth': {
      const a = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return iso(a, new Date(today.getFullYear(), today.getMonth(), 1), a.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }));
    }
    case 'day': {
      const d = day ? new Date(`${day}T00:00:00`) : today;
      return iso(d, addDays(d, 1), d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }));
    }
    default: return iso(today, addDays(today, 1), "Aujourd'hui");
  }
}

const fmtTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

/**
 * Reports — a station's till activity over a period (owner, station manager,
 * accountant): sales by payment method, by cashier, day by day, the cash
 * sessions and their discrepancies, the voided lines, the best products and
 * the stock to watch; exportable as PDF / Excel. The owner can also see all
 * the stations side by side. ?date=YYYY-MM-DD&station=<id> opens a given day
 * (the evening report notification links here).
 */
export default function ReportsPage() {
  const user = useAuthStore((s) => s.user);
  const isOwner = user?.role === 'enterprise' || !!user?.acting_as_org_id;
  const [searchParams] = useSearchParams();
  const linkedDay = searchParams.get('date') || '';
  const [preset, setPreset] = useState<Preset>(linkedDay ? 'day' : 'today');
  const [day, setDay] = useState(linkedDay);
  const [currency, setCurrency] = useState<'CDF' | 'USD'>('CDF');
  const range = useMemo(() => rangeOf(preset, day), [preset, day]);

  const { data: org } = useQuery({ queryKey: ['my-organization'], queryFn: async () => (await api.get('/organizations/me')).data });
  const { data: stations } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data as { id: string; name: string }[],
    enabled: !!org?.id,
  });

  // Owner: one station or all of them (shared with the dashboard's choice). Staff: their own station.
  const scope = useStationScope();
  const linkedStation = searchParams.get('station');
  const [ownerPick, setOwnerPick] = useState<string | null | undefined>(linkedStation ?? undefined);
  const ownerStation = ownerPick !== undefined ? resolveStation(ownerPick, stations) : resolveStation(scope.stationId, stations);
  const stationId = isOwner ? ownerStation : stations?.[0]?.id ?? null;
  const allStations = isOwner && !stationId;

  const params = { from: range.from, to: range.to, currency };
  const { data: report, isLoading } = useQuery({
    queryKey: ['station-report', stationId, params],
    queryFn: async () => (await api.get(`/merchants/${stationId}/reports`, { params })).data,
    enabled: !!stationId,
  });
  const { data: orgReport, isLoading: orgLoading } = useQuery({
    queryKey: ['org-report', org?.id, params],
    queryFn: async () => (await api.get(`/organizations/${org.id}/reports`, { params })).data,
    enabled: allStations && !!org?.id,
  });

  const money = (cents: number) => formatCurrency(cents || 0, currency);
  const loading = allStations ? orgLoading : isLoading || !stationId;
  const fileBase = `rapport-${(allStations ? 'toutes-stations' : report?.station?.name || 'station').toLowerCase().replace(/\s+/g, '-')}-${range.label.replace(/\s+/g, '-')}`;

  const exportPdf = async () => {
    const meta = { orgName: org?.name, periodLabel: range.label };
    const doc = allStations ? buildOrganizationReportPdf(orgReport, meta) : buildStationReportPdf(report, meta);
    await deliverPdf(doc, `${fileBase}.pdf`);
  };

  const exportCsv = () => {
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const amount = (c: number) => (c || 0) / 100;
    const rows: string[] = allStations
      ? [
          `Rapport;${esc(org?.name)};Toutes les stations;${esc(range.label)};${currency}`, '',
          'Station;Ventes;Tickets;Especes;ScanLinkPay;Ecart;Annulations;Ruptures',
          ...orgReport.stations.map((s: any) => [esc(s.name), amount(s.revenue_cents), s.tickets, amount(s.cash_cents), amount(s.scanlinkpay_cents), amount(s.discrepancy_cents), s.voids, s.stock_alerts].join(';')),
        ]
      : [
          `Rapport;${esc(org?.name)};${esc(report.station.name)};${esc(range.label)};${currency}`, '',
          'Indicateur;Valeur',
          `Chiffre d'affaires;${amount(report.totals.revenue_cents)}`,
          `Tickets;${report.totals.tickets}`,
          ...Object.entries(report.totals.by_method).map(([m, v]) => `${METHOD_LABELS[m] || m};${amount(v as number)}`),
          `Ecart de caisse;${amount(report.sessions_total.discrepancy_cents)}`, '',
          'Caissier;Tickets;Ventes;Especes;Annulations;Ecart',
          ...report.by_cashier.map((c: any) => [esc(c.name), c.tickets, amount(c.revenue_cents), amount(c.cash_cents), c.voids, amount(c.discrepancy_cents)].join(';')), '',
          'Jour;Tickets;Ventes',
          ...report.daily.map((d: any) => `${d.date};${d.tickets};${amount(d.revenue_cents)}`), '',
          'Annule le;Par;Produit;Quantite;Montant;Motif',
          ...report.voids.map((v: any) => [v.at, esc(v.by), esc(v.product), v.quantity, amount(v.amount_cents), esc(v.reason)].join(';')),
        ];
    const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${fileBase}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const ready = allStations ? !!orgReport : !!report;
  const maxDay = Math.max(1, ...((report?.daily || []) as any[]).map((d) => d.revenue_cents));

  return (
    <div className="p-4 md:p-6 pb-28 md:pb-6 space-y-5 max-w-3xl lg:max-w-6xl mx-auto">
      <PageHeader title="Rapports" />

      {/* Station (owner) */}
      {isOwner && stations && stations.length > 0 && (
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
      {!isOwner && stations?.[0] && <p className="text-sm text-muted-foreground">{org?.name} · {stations[0].name}</p>}

      {/* Period + currency */}
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPreset(p.key)}
            className={cn('rounded-full border px-3 py-1.5 text-sm font-medium', preset === p.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground')}
          >
            {p.label}
          </button>
        ))}
        <div className="ml-auto flex gap-1.5">
          {(['CDF', 'USD'] as const).map((c) => (
            <button key={c} onClick={() => setCurrency(c)} className={cn('rounded-full border px-3 py-1.5 text-sm font-medium', currency === c ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground')}>
              {c}
            </button>
          ))}
        </div>
      </div>
      {preset === 'day' && (
        <Input type="date" value={day} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDay(e.target.value)} className="max-w-xs" />
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium capitalize text-foreground">{range.label}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={!ready} onClick={exportCsv}><FileDown className="mr-1 h-4 w-4" /> Excel</Button>
          <Button size="sm" disabled={!ready} onClick={exportPdf}><FileText className="mr-1 h-4 w-4" /> PDF</Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : allStations && orgReport ? (
        // ---------------- Every station side by side ----------------
        <Card>
          <CardHeader><CardTitle className="text-base">Toutes les stations</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="py-2 pr-3">Station</th><th className="pr-3">Ventes</th><th className="pr-3">Tickets</th><th className="pr-3">Espèces</th><th className="pr-3">Écart</th><th className="pr-3">Annul.</th><th>Ruptures</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orgReport.stations.map((s: any) => (
                  <tr key={s.merchant_id} className="cursor-pointer hover:bg-accent/50" onClick={() => { setOwnerPick(s.merchant_id); scope.setStation(s.merchant_id); }}>
                    <td className="py-2.5 pr-3 font-medium text-foreground">{s.name}</td>
                    <td className="pr-3 font-semibold">{money(s.revenue_cents)}</td>
                    <td className="pr-3">{s.tickets}</td>
                    <td className="pr-3">{money(s.cash_cents)}</td>
                    <td className={cn('pr-3', s.discrepancy_cents ? 'font-semibold text-destructive' : '')}>{money(s.discrepancy_cents)}</td>
                    <td className="pr-3">{s.voids}</td>
                    <td className={s.stock_alerts ? 'font-semibold text-amber-600' : ''}>{s.stock_alerts}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border font-semibold">
                <tr><td className="py-2.5 pr-3">Total</td><td className="pr-3">{money(orgReport.totals.revenue_cents)}</td><td className="pr-3">{orgReport.totals.tickets}</td><td /><td className={cn('pr-3', orgReport.totals.discrepancy_cents ? 'text-destructive' : '')}>{money(orgReport.totals.discrepancy_cents)}</td><td className="pr-3">{orgReport.totals.voids}</td><td>{orgReport.totals.stock_alerts}</td></tr>
              </tfoot>
            </table>
            <p className="mt-3 text-xs text-muted-foreground">Touchez une station pour voir son rapport détaillé.</p>
          </CardContent>
        </Card>
      ) : report ? (
        // ---------------- One station ----------------
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Chiffre d'affaires", value: money(report.totals.revenue_cents), icon: Receipt },
              { label: 'Tickets', value: String(report.totals.tickets), icon: Receipt },
              { label: 'Panier moyen', value: money(report.totals.avg_basket_cents), icon: Receipt },
              { label: 'Écart de caisse', value: money(report.sessions_total.discrepancy_cents), icon: Vault, alert: !!report.sessions_total.discrepancy_cents },
            ].map((k) => (
              <div key={k.label} className={cn('rounded-2xl border bg-card p-4', k.alert ? 'border-destructive/40' : 'border-border')}>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><k.icon className="h-3.5 w-3.5" /> {k.label}</p>
                <p className={cn('mt-1 text-lg font-bold [overflow-wrap:anywhere]', k.alert ? 'text-destructive' : 'text-foreground')}>{k.value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Modes de paiement</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {Object.keys(report.totals.by_method).length === 0 && <p className="text-sm text-muted-foreground">Aucune vente sur la période.</p>}
                {Object.entries(report.totals.by_method).map(([m, v]) => (
                  <div key={m} className="flex justify-between text-sm"><span>{METHOD_LABELS[m] || m}</span><span className="font-semibold">{money(v as number)}</span></div>
                ))}
                <p className="pt-2 text-xs text-muted-foreground">Ventes de la caisse. Les paiements ScanLinkPay reçus hors caisse (QR, carte) sont dans Transactions.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Par caissier</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                {!report.by_cashier.length ? <p className="text-sm text-muted-foreground">Aucune activité.</p> : (
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 pr-2">Caissier</th><th className="pr-2">Tickets</th><th className="pr-2">Ventes</th><th className="pr-2">Annul.</th><th>Écart</th></tr></thead>
                    <tbody className="divide-y divide-border">
                      {report.by_cashier.map((c: any) => (
                        <tr key={c.user_id}>
                          <td className="py-2 pr-2 font-medium">{c.name}</td><td className="pr-2">{c.tickets}</td><td className="pr-2">{money(c.revenue_cents)}</td>
                          <td className={cn('pr-2', c.voids ? 'font-semibold text-amber-600' : '')}>{c.voids}</td>
                          <td className={c.discrepancy_cents ? 'font-semibold text-destructive' : ''}>{money(c.discrepancy_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>

          {report.daily.length > 1 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Par jour</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {report.daily.map((d: any) => (
                  <div key={d.date} className="flex items-center gap-3 text-sm">
                    <span className="w-20 flex-shrink-0 text-muted-foreground">{new Date(`${d.date}T12:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</span>
                    <div className="h-2.5 flex-1 rounded-full bg-muted"><div className="h-2.5 rounded-full bg-primary" style={{ width: `${(d.revenue_cents / maxDay) * 100}%` }} /></div>
                    <span className="w-32 flex-shrink-0 text-right font-medium">{money(d.revenue_cents)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Vault className="h-4 w-4" /> Caisses et écarts</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              {!report.sessions.length ? <p className="text-sm text-muted-foreground">Aucune caisse ouverte sur la période.</p> : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 pr-2">Caissier</th><th className="pr-2">Ouverture</th><th className="pr-2">Fermeture</th><th className="pr-2">Attendu</th><th className="pr-2">Compté</th><th>Écart</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {report.sessions.map((s: any) => (
                      <tr key={s.id}>
                        <td className="py-2 pr-2 font-medium">{s.cashier_name}</td>
                        <td className="pr-2">{fmtTime(s.opened_at)}</td>
                        <td className="pr-2">{s.status === 'open' ? <span className="text-success">ouverte</span> : fmtTime(s.closed_at)}</td>
                        <td className="pr-2">{s.expected_cents == null ? '—' : money(s.expected_cents)}</td>
                        <td className="pr-2">{s.closing_counted_cents == null ? '—' : money(s.closing_counted_cents)}</td>
                        <td className={s.discrepancy_cents ? 'font-semibold text-destructive' : ''}>{s.discrepancy_cents == null ? '—' : money(s.discrepancy_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Ban className="h-4 w-4" /> Articles annulés ({report.voids_total.count} · {money(report.voids_total.amount_cents)})</CardTitle></CardHeader>
            <CardContent>
              {!report.voids.length ? <p className="text-sm text-muted-foreground">Aucune annulation.</p> : (
                <div className="divide-y divide-border">
                  {report.voids.map((v: any, i: number) => (
                    <div key={i} className="flex items-start justify-between gap-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium">{v.quantity} × {v.product}{v.ticket_number ? <span className="text-muted-foreground"> · ticket #{v.ticket_number}</span> : null}</p>
                        <p className="text-xs text-muted-foreground">{fmtTime(v.at)} · {v.by}{v.reason ? ` · « ${v.reason} »` : ''}</p>
                      </div>
                      <span className="flex-shrink-0 font-semibold">{money(v.amount_cents)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Trophy className="h-4 w-4" /> Meilleurs produits</CardTitle></CardHeader>
              <CardContent className="divide-y divide-border">
                {!report.top_products.length && <p className="text-sm text-muted-foreground">Aucune vente.</p>}
                {report.top_products.map((p: any) => (
                  <div key={p.name} className="flex justify-between gap-3 py-2 text-sm"><span className="min-w-0 truncate">{p.name} <span className="text-muted-foreground">× {p.quantity}</span></span><span className="font-semibold">{money(p.revenue_cents)}</span></div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><PackageX className="h-4 w-4" /> Stock à surveiller</CardTitle></CardHeader>
              <CardContent className="divide-y divide-border">
                {!report.stock_alerts.length && <p className="text-sm text-muted-foreground">Aucun produit en stock bas.</p>}
                {report.stock_alerts.map((s: any) => (
                  <div key={s.id} className="flex justify-between gap-3 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-1.5 truncate">{s.quantity <= 0 && <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-destructive" />}{s.name}</span>
                    <span className={cn('font-semibold', s.quantity <= 0 ? 'text-destructive' : 'text-amber-600')}>{s.quantity <= 0 ? 'Rupture' : `${s.quantity} restant${s.quantity > 1 ? 's' : ''}`}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <p className="py-16 text-center text-sm text-muted-foreground">Aucune station disponible.</p>
      )}
    </div>
  );
}
