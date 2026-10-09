import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import jsPDF from 'jspdf';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import api from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SaleInvoice } from '@/components/sales/SaleInvoice';
import { PRESETS, presetRange, type Preset } from '@/pages/organization/Transactions';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { formatCurrency, cn } from '@/lib/utils';
import { Archive, FileSpreadsheet, Loader2, Printer, Receipt, FileText } from 'lucide-react';

// "Toutes les ventes": every sale not archived, in a table that can be
// filtered by period, printed, saved as PDF or opened in Excel. Archiving
// hides a sale from this table only; its data stays in the database and in
// the dashboards.

type Row = {
  id: string;
  reference: string;
  status: string;
  payment_method: string;
  currency: string;
  total_cents: number;
  created_at: string;
  items_count: number;
  items_preview: string;
};

function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function methodLabel(m: string) {
  return m === 'cash' ? 'Espèces' : 'Wallet ScanLinkPay';
}
function statusLabel(s: string) {
  return s === 'PAID' ? 'Payée' : 'En attente';
}

/** Totals per currency, never added across currencies. */
function totalsByCurrency(rows: Row[]) {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.status !== 'PAID') continue;
    out[r.currency] = (out[r.currency] || 0) + r.total_cents;
  }
  return out;
}

function escapeXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Excel opens SpreadsheetML 2003 XML natively: no library needed. */
function buildExcelXml(rows: Row[], period: string) {
  const header = ['Date', 'Heure', 'Référence', 'Articles', 'Paiement', 'Statut', 'Devise', 'Montant'];
  const cell = (v: string | number, type: 'String' | 'Number' = 'String') =>
    `<Cell><Data ss:Type="${type}">${typeof v === 'string' ? escapeXml(v) : v}</Data></Cell>`;
  const body = rows
    .map(
      (r) =>
        `<Row>${cell(dateLabel(r.created_at))}${cell(timeLabel(r.created_at))}${cell(r.reference)}${cell(
          `${r.items_preview} (${r.items_count})`,
        )}${cell(methodLabel(r.payment_method))}${cell(statusLabel(r.status))}${cell(r.currency)}${cell(
          r.total_cents / 100,
          'Number',
        )}</Row>`,
    )
    .join('');
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Ventes"><Table>
<Row>${cell(`Ventes — ${period}`)}</Row>
<Row>${header.map((h) => cell(h)).join('')}</Row>
${body}
</Table></Worksheet></Workbook>`;
}

/** Landscape A4 table with a header row repeated on every page. */
function buildTablePdf(rows: Row[], period: string, orgName: string) {
  const doc = new jsPDF({ orientation: 'landscape', format: 'a4', unit: 'mm' });
  const cols = [
    { label: 'Date', x: 12, w: 24 },
    { label: 'Heure', x: 36, w: 16 },
    { label: 'Référence', x: 52, w: 46 },
    { label: 'Articles', x: 98, w: 92 },
    { label: 'Paiement', x: 190, w: 34 },
    { label: 'Statut', x: 224, w: 22 },
    { label: 'Montant', x: 246, w: 40, right: true },
  ];
  const pageH = doc.internal.pageSize.getHeight();
  const drawHeader = (y: number) => {
    doc.setFillColor(80, 72, 229);
    doc.rect(10, y, 277, 7, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    cols.forEach((c) => doc.text(c.label, c.right ? c.x + c.w - 2 : c.x + 1, y + 4.6, { align: c.right ? 'right' : 'left' }));
  };

  doc.setTextColor(30, 30, 40);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Toutes les ventes', 12, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110, 110, 130);
  doc.text(`${orgName}  ·  ${period}  ·  ${rows.length} vente${rows.length > 1 ? 's' : ''}`, 12, 22);

  let y = 28;
  drawHeader(y);
  y += 7;
  rows.forEach((r, i) => {
    if (y > pageH - 16) {
      doc.addPage();
      y = 12;
      drawHeader(y);
      y += 7;
    }
    if (i % 2 === 1) {
      doc.setFillColor(246, 245, 253);
      doc.rect(10, y, 277, 6.5, 'F');
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(30, 30, 40);
    const values = [
      dateLabel(r.created_at),
      timeLabel(r.created_at),
      r.reference,
      `${r.items_preview}`,
      methodLabel(r.payment_method),
      statusLabel(r.status),
      formatCurrency(r.total_cents, r.currency),
    ];
    cols.forEach((c, idx) => {
      const text = doc.splitTextToSize(values[idx], c.w - 3)[0] as string;
      doc.text(text, c.right ? c.x + c.w - 2 : c.x + 1, y + 4.4, { align: c.right ? 'right' : 'left' });
    });
    y += 6.5;
  });

  const totals = totalsByCurrency(rows);
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  Object.entries(totals).forEach(([cur, amount]) => {
    doc.text(`Total encaissé ${cur} : ${formatCurrency(amount, cur)}`, 287, y, { align: 'right' });
    y += 5;
  });
  return doc;
}

async function deliver(blob: Blob | null, filename: string, doc?: jsPDF, text?: string) {
  if (Capacitor.isNativePlatform()) {
    const data = doc
      ? doc.output('datauristring').split(',')[1]
      : btoa(unescape(encodeURIComponent(text || '')));
    const { uri } = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache });
    await Share.share({ title: filename, files: [uri], dialogTitle: 'Enregistrer ou partager' });
    return;
  }
  if (doc) return doc.save(filename);
  if (blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export default function SalesHistoryPage() {
  const queryClient = useQueryClient();
  const [preset, setPreset] = useState<Preset>('today');
  const [customDate, setCustomDate] = useState('');
  const [openSaleId, setOpenSaleId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Row | null>(null);
  const [exporting, setExporting] = useState(false);
  const range = useMemo(() => presetRange(preset, customDate), [preset, customDate]);

  const periodLabel = PRESETS.find((p) => p.value === preset)?.label || '';

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
  });

  const { data: rowsData, isLoading } = useQuery({
    queryKey: ['org-sales-history', org?.id, range.from, range.to],
    queryFn: async () =>
      (await api.get(`/organizations/${org.id}/sales/history`, { params: { from: range.from, to: range.to } })).data,
    enabled: !!org?.id && (preset !== 'custom' || !!customDate),
  });

  const { data: openSale } = useQuery({
    queryKey: ['org-sale', org?.id, openSaleId],
    queryFn: async () => (await api.get(`/organizations/${org.id}/sales/${openSaleId}`)).data,
    enabled: !!org?.id && !!openSaleId,
  });

  useRealtimeInvalidate(
    'sales',
    org?.id ? `organization_id=eq.${org.id}` : undefined,
    [['org-sales-history', org?.id, range.from, range.to]],
    !!org?.id,
  );

  const archiveMutation = useMutation({
    // The API asks for the user's own access code (dialog handled by api.ts).
    mutationFn: async (sale: Row) => api.post(`/organizations/${org.id}/sales/${sale.id}/archive`),
    onSuccess: () => {
      setArchiveTarget(null);
      queryClient.invalidateQueries({ queryKey: ['org-sales-history', org.id] });
    },
  });

  const rows: Row[] = rowsData || [];
  const totals = useMemo(() => totalsByCurrency(rows), [rows]);

  const exportPdf = async () => {
    setExporting(true);
    try {
      const doc = buildTablePdf(rows, periodLabel, org?.name || '');
      await deliver(null, `ventes-${preset}.pdf`, doc);
    } finally {
      setExporting(false);
    }
  };

  const exportExcel = async () => {
    const xml = buildExcelXml(rows, periodLabel);
    await deliver(new Blob([xml], { type: 'application/vnd.ms-excel' }), `ventes-${preset}.xls`, undefined, xml);
  };

  return (
    <div className="max-w-6xl mx-auto">
      {openSaleId && org && openSale?.sale_items && (
        <SaleInvoice org={org} sale={openSale} onClose={() => setOpenSaleId(null)} />
      )}

      <div className="no-print sticky top-20 md:top-0 z-10 bg-background px-6 pt-6 pb-4 space-y-3">
        <PageHeader title="Toutes les ventes" />
        <div className="flex gap-2 overflow-x-auto pb-1">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPreset(p.value)}
              className={cn(
                'flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-medium border',
                preset === p.value ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <Input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => window.print()} disabled={!rows.length}>
            <Printer className="mr-1.5 w-4 h-4" />
            Imprimer
          </Button>
          <Button size="sm" variant="outline" onClick={exportPdf} disabled={!rows.length || exporting}>
            {exporting ? <Loader2 className="mr-1.5 w-4 h-4 animate-spin" /> : <FileText className="mr-1.5 w-4 h-4" />}
            PDF
          </Button>
          <Button size="sm" variant="outline" onClick={exportExcel} disabled={!rows.length}>
            <FileSpreadsheet className="mr-1.5 w-4 h-4" />
            Excel
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            {rows.length} vente{rows.length > 1 ? 's' : ''}
            {Object.entries(totals).map(([cur, amt]) => ` · ${formatCurrency(amt, cur)}`).join('')}
          </span>
        </div>
      </div>

      <div className="px-6 pb-10" id="sales-table-print">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !rows.length ? (
          <div className="text-center py-16">
            <Receipt className="w-10 h-10 mx-auto mb-3 text-muted-foreground opacity-40" />
            <p className="text-muted-foreground">Aucune vente sur cette période.</p>
          </div>
        ) : (
          <>
            {/* The table on every screen: only the table scrolls sideways on phones. */}
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-primary/5 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold">Date</th>
                      <th className="px-4 py-3 text-left font-semibold">Heure</th>
                      <th className="px-4 py-3 text-left font-semibold">Référence</th>
                      <th className="px-4 py-3 text-left font-semibold">Articles</th>
                      <th className="px-4 py-3 text-left font-semibold">Paiement</th>
                      <th className="px-4 py-3 text-left font-semibold">Statut</th>
                      <th className="px-4 py-3 text-right font-semibold">Montant</th>
                      <th className="no-print px-2 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t border-border hover:bg-accent/40 cursor-pointer" onClick={() => setOpenSaleId(r.id)}>
                        <td className="px-4 py-3 whitespace-nowrap">{dateLabel(r.created_at)}</td>
                        <td className="px-4 py-3 whitespace-nowrap tabular-nums font-semibold">{timeLabel(r.created_at)}</td>
                        <td className="px-4 py-3 font-mono text-xs">{r.reference}</td>
                        <td className="px-4 py-3">
                          {r.items_preview} <span className="text-muted-foreground">({r.items_count})</span>
                        </td>
                        <td className="px-4 py-3">{methodLabel(r.payment_method)}</td>
                        <td className="px-4 py-3">
                          <Badge variant={r.status === 'PAID' ? 'success' : 'secondary'}>{statusLabel(r.status)}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-bold whitespace-nowrap">{formatCurrency(r.total_cents, r.currency)}</td>
                        <td className="no-print px-2 py-3">
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Archiver de la liste"
                            onClick={(e) => {
                              e.stopPropagation();
                              setArchiveTarget(r);
                            }}
                          >
                            <Archive className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>

      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title="Archiver cette vente ?"
        description="Elle disparaîtra de l'historique mais ses données sont conservées. Vous devrez confirmer avec votre code d'accès."
        confirmLabel="Archiver"
        onConfirm={() => { if (archiveTarget) archiveMutation.mutate(archiveTarget); }}
      />

      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          body * { visibility: hidden; }
          #sales-table-print, #sales-table-print * { visibility: visible; }
          #sales-table-print { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
          #sales-table-print table { font-size: 10px; }
          #sales-table-print .md\\:hidden { display: none !important; }
          #sales-table-print .hidden.md\\:block { display: block !important; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}
