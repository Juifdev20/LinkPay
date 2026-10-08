import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jsPDF } from 'jspdf';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/PageHeader';
import { formatCurrency, formatShortDate } from '@/lib/utils';
import {
  TrendingUp, Receipt, ShoppingBasket, Percent, Loader2,
  Store, Banknote, QrCode, Trophy, PackageX, FileDown, FileText,
} from 'lucide-react';

const PERIODS = [
  { key: 'today', label: "Aujourd'hui", days: 0 },
  { key: '7d', label: '7 jours', days: 7 },
  { key: '30d', label: '30 jours', days: 30 },
  { key: '90d', label: '90 jours', days: 90 },
];

const METHOD_LABELS: Record<string, { label: string; icon: any }> = {
  cash: { label: 'Espèces', icon: Banknote },
  scanlinkpay: { label: 'ScanLinkPay', icon: QrCode },
  mixed: { label: 'Mixte', icon: Receipt },
};

function range(periodKey: string) {
  const p = PERIODS.find((x) => x.key === periodKey) || PERIODS[1];
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - p.days);
  from.setHours(0, 0, 0, 0);
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * Statistiques de vente (spec 3.1) — CA jour/semaine/mois, panier moyen,
 * marge bénéficiaire, palmarès des produits, dead stock, et export du
 * rapport en CSV (Excel) ou PDF pour la comptabilité externe.
 */
export default function SalesStatsPage() {
  const user = useAuthStore((s) => s.user);
  const [pickedMerchant, setPickedMerchant] = useState('');
  const [currency, setCurrency] = useState<'CDF' | 'USD'>('CDF');
  const [period, setPeriod] = useState('30d');
  const { from, to } = useMemo(() => range(period), [period]);

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
    enabled: !user?.merchant_id,
  });

  const { data: merchants } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data,
    enabled: !user?.merchant_id && !!org?.id,
  });

  const merchantId = user?.merchant_id || pickedMerchant || (merchants?.length === 1 ? merchants[0].id : '');
  const merchantName = merchants?.find((m: any) => m.id === merchantId)?.name;

  const params = { from, to, currency };
  const { data: summary, isLoading } = useQuery({
    queryKey: ['pos-stats-summary', merchantId, period, currency],
    queryFn: async () => (await api.get(`/merchants/${merchantId}/pos/stats/summary`, { params })).data,
    enabled: !!merchantId,
  });
  const { data: daily } = useQuery({
    queryKey: ['pos-stats-daily', merchantId, period, currency],
    queryFn: async () => (await api.get(`/merchants/${merchantId}/pos/stats/daily`, { params })).data,
    enabled: !!merchantId,
  });
  const { data: top } = useQuery({
    queryKey: ['pos-stats-top', merchantId, period, currency],
    queryFn: async () => (await api.get(`/merchants/${merchantId}/pos/stats/top-products`, { params: { ...params, limit: 10 } })).data,
    enabled: !!merchantId,
  });
  const { data: dead } = useQuery({
    queryKey: ['pos-stats-dead', merchantId, period, currency],
    queryFn: async () => (await api.get(`/merchants/${merchantId}/pos/stats/dead-stock`, { params: { ...params, limit: 15 } })).data,
    enabled: !!merchantId,
  });

  const maxDaily = Math.max(1, ...(daily || []).map((d: any) => d.revenue_cents));
  const periodLabel = PERIODS.find((p) => p.key === period)?.label || period;

  // ------------------------------------------------------------------
  // Exports — CSV opens in Excel (semicolon-separated + BOM for French
  // Excel), PDF is a compact printable report via jspdf.
  // ------------------------------------------------------------------
  const exportCsv = () => {
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows: string[] = [
      `Rapport des ventes;${merchantName || 'Boutique'};${periodLabel};${currency}`,
      '',
      'Indicateur;Valeur',
      `Chiffre d'affaires TTC;${(summary?.revenue_cents || 0) / 100}`,
      `Tickets;${summary?.tickets_count || 0}`,
      `Panier moyen;${(summary?.avg_basket_cents || 0) / 100}`,
      `TVA;${(summary?.tva_cents || 0) / 100}`,
      `Marge;${(summary?.margin_cents || 0) / 100}`,
      `Marge %;${summary?.margin_pct ?? ''}`,
      '',
      'Date;Tickets;CA',
      ...(daily || []).map((d: any) => `${d.date};${d.tickets};${d.revenue_cents / 100}`),
      '',
      'Produit;Quantite;CA;Marge',
      ...(top || []).map((p: any) => `${esc(p.name)};${p.qty};${p.revenue_cents / 100};${p.margin_cents / 100}`),
    ];
    const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ventes-${merchantName || 'boutique'}-${periodLabel}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportPdf = () => {
    const doc = new jsPDF();
    let y = 18;
    doc.setFontSize(16);
    doc.text(`Rapport des ventes — ${merchantName || 'Boutique'}`, 14, y);
    y += 8;
    doc.setFontSize(10);
    doc.text(`Periode : ${periodLabel} · Devise : ${currency} · Genere le ${new Date().toLocaleDateString('fr-CD')}`, 14, y);
    y += 10;

    doc.setFontSize(12);
    doc.text('Indicateurs', 14, y); y += 6;
    doc.setFontSize(10);
    const kpis = [
      [`Chiffre d'affaires TTC`, formatCurrency(summary?.revenue_cents || 0, currency)],
      ['Tickets', String(summary?.tickets_count || 0)],
      ['Panier moyen', formatCurrency(summary?.avg_basket_cents || 0, currency)],
      ['TVA', formatCurrency(summary?.tva_cents || 0, currency)],
      ['Marge', `${formatCurrency(summary?.margin_cents || 0, currency)}${summary?.margin_pct != null ? ` (${summary.margin_pct}%)` : ''}`],
    ];
    for (const [k, v] of kpis) { doc.text(`  ${k} : ${v}`, 14, y); y += 5.5; }
    y += 4;

    doc.setFontSize(12);
    doc.text('Top produits', 14, y); y += 6;
    doc.setFontSize(9);
    doc.text('Produit', 14, y); doc.text('Qte', 120, y); doc.text('CA', 140, y); doc.text('Marge', 170, y); y += 5;
    for (const p of (top || []).slice(0, 15)) {
      if (y > 275) { doc.addPage(); y = 18; }
      doc.text(String(p.name).slice(0, 55), 14, y);
      doc.text(String(p.qty), 120, y);
      doc.text(formatCurrency(p.revenue_cents, currency), 140, y);
      doc.text(formatCurrency(p.margin_cents, currency), 170, y);
      y += 5;
    }
    doc.save(`ventes-${merchantName || 'boutique'}-${periodLabel}.pdf`);
  };

  return (
    <div className="p-6 pb-28 md:pb-6 space-y-5 max-w-3xl lg:max-w-6xl mx-auto">
      <PageHeader title="Statistiques de vente" />

      {!user?.merchant_id && merchants?.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {merchants.map((m: any) => (
            <button key={m.id} onClick={() => setPickedMerchant(m.id)}
              className={`flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-medium border ${merchantId === m.id ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}>
              {m.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {PERIODS.map((p) => (
            <button key={p.key} onClick={() => setPeriod(p.key)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium border ${period === p.key ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {(['CDF', 'USD'] as const).map((c) => (
            <button key={c} onClick={() => setCurrency(c)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium border ${currency === c ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}>
              {c}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!summary}>
          <FileDown className="w-4 h-4 mr-1.5" /> CSV
        </Button>
        <Button size="sm" variant="outline" onClick={exportPdf} disabled={!summary}>
          <FileText className="w-4 h-4 mr-1.5" /> PDF
        </Button>
      </div>

      {!merchantId && (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">
          <Store className="w-8 h-8 mx-auto mb-2" /> Aucune boutique disponible.
        </CardContent></Card>
      )}

      {merchantId && isLoading && (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      )}

      {merchantId && summary && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: "Chiffre d'affaires", value: formatCurrency(summary.revenue_cents, currency), icon: TrendingUp },
              { label: 'Tickets', value: String(summary.tickets_count), icon: Receipt },
              { label: 'Panier moyen', value: formatCurrency(summary.avg_basket_cents, currency), icon: ShoppingBasket },
              {
                label: 'Marge',
                value: summary.margin_pct != null ? `${formatCurrency(summary.margin_cents, currency)} (${summary.margin_pct}%)` : formatCurrency(summary.margin_cents, currency),
                icon: Percent,
              },
            ].map((k) => (
              <Card key={k.label}>
                <CardContent className="pt-4 pb-4">
                  <k.icon className="w-5 h-5 text-primary mb-2" />
                  <p className="text-xs text-muted-foreground">{k.label}</p>
                  <p className="text-lg font-bold text-foreground leading-tight">{k.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* CA par jour + répartition par moyen de paiement — côte à côte sur desktop */}
          <div className="lg:grid lg:grid-cols-[3fr_2fr] lg:gap-5 space-y-5 lg:space-y-0">
            <Card>
              <CardHeader><CardTitle className="text-base">Chiffre d'affaires par jour</CardTitle></CardHeader>
              <CardContent>
                {(daily || []).length ? (
                  <div className="flex items-end gap-1 h-40">
                    {(daily || []).map((d: any) => (
                      <div key={d.date} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${formatShortDate(d.date)} — ${formatCurrency(d.revenue_cents, currency)} (${d.tickets} tickets)`}>
                        <div className="w-full rounded-t bg-primary/80 hover:bg-primary transition-colors" style={{ height: `${Math.max(2, (d.revenue_cents / maxDaily) * 100)}%` }} />
                        <span className="text-[9px] text-muted-foreground truncate w-full text-center">{d.date.slice(5)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-6">Aucune vente sur la période.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Encaissements par moyen de paiement</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(summary.by_method || {}).map(([method, v]: [string, any]) => {
                  const M = METHOD_LABELS[method] || { label: method, icon: Receipt };
                  const share = summary.revenue_cents > 0 ? Math.round((v.amount_cents / summary.revenue_cents) * 100) : 0;
                  return (
                    <div key={method} className="flex items-center gap-3">
                      <M.icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm text-foreground w-28 truncate">{M.label}</span>
                      <div className="flex-1 h-2 rounded-full bg-secondary overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${share}%` }} />
                      </div>
                      <span className="text-sm font-medium text-foreground w-28 text-right">{formatCurrency(v.amount_cents, currency)}</span>
                      <Badge variant="outline" className="w-10 justify-center">{share}%</Badge>
                    </div>
                  );
                })}
                {summary.tickets_count === 0 && <p className="text-sm text-muted-foreground text-center py-2">Aucun encaissement.</p>}
                <div className="flex justify-between text-xs text-muted-foreground pt-2 border-t border-border">
                  <span>dont TVA collectée</span>
                  <span>{formatCurrency(summary.tva_cents, currency)}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Palmarès + dead stock — côte à côte sur desktop */}
          <div className="lg:grid lg:grid-cols-2 lg:gap-5 space-y-5 lg:space-y-0">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Trophy className="w-5 h-5" /> Top ventes</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {(top || []).map((p: any, i: number) => (
                  <div key={p.stock_item_id} className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-secondary text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.qty} vendu(s) · marge {formatCurrency(p.margin_cents, currency)}</p>
                    </div>
                    <p className="text-sm font-semibold text-foreground flex-shrink-0">{formatCurrency(p.revenue_cents, currency)}</p>
                  </div>
                ))}
                {!(top || []).length && <p className="text-sm text-muted-foreground text-center py-2">Aucune vente sur la période.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><PackageX className="w-5 h-5" /> Rotation lente</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">Produits en rayon sans aucune vente sur la période — classés par valeur immobilisée.</p>
                {(dead || []).map((d: any) => (
                  <div key={d.stock_item_id} className="flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground truncate">{d.name}</p>
                      <p className="text-xs text-muted-foreground">{d.category || 'Sans rayon'} · {d.quantity} en stock</p>
                    </div>
                    <p className="font-semibold text-foreground flex-shrink-0">{formatCurrency(d.tied_up_value_cents, d.currency)}</p>
                  </div>
                ))}
                {!(dead || []).length && <p className="text-sm text-muted-foreground text-center py-2">Tous les produits en rayon ont vendu sur la période.</p>}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
