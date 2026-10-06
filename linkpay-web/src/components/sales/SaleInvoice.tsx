import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { Printer, Download, X, Loader2 } from 'lucide-react';
import logoSrc from '@/assets/logo.png';
import { buildInvoiceModel, type InvoiceOrg, type InvoiceSale } from '@/lib/sale-invoice';
import { downloadSaleInvoicePdf } from '@/lib/sale-invoice-pdf';

/**
 * The sale invoice, on screen and on paper. One invoice fills one third of
 * an A4 sheet (99 mm), so the sheet can be reused for three invoices. Only
 * this invoice is printed (print CSS below), and the browser's print dialog
 * lets the user choose the printer.
 */
export function SaleInvoice({
  org,
  sale,
  onClose,
}: {
  org: InvoiceOrg;
  sale: InvoiceSale;
  onClose: () => void;
}) {
  const model = useMemo(() => buildInvoiceModel(org, sale), [org, sale]);
  const [saleQr, setSaleQr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!model.salePaymentUrl) return;
    QRCode.toDataURL(model.salePaymentUrl, { width: 240, margin: 1, color: { dark: '#0F172A', light: '#FFFFFF' } })
      .then(setSaleQr)
      .catch(() => setSaleQr(''));
  }, [model.salePaymentUrl]);

  const handleShare = async () => {
    setBusy(true);
    try {
      await downloadSaleInvoicePdf(org, sale);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-y-auto">
      {/* Screen-only toolbar. Wraps on phones so every button stays on screen. */}
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-3">
        <p className="min-w-0 truncate font-semibold text-foreground">Facture {model.reference}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => window.print()}>
            <Printer className="mr-1.5 w-4 h-4" />
            Imprimer
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={handleShare}>
            {busy ? <Loader2 className="mr-1.5 w-4 h-4 animate-spin" /> : <Download className="mr-1.5 w-4 h-4" />}
            PDF / Partager
          </Button>
          <Button size="icon" variant="ghost" onClick={onClose} aria-label="Fermer">
            <X className="w-5 h-5" />
          </Button>
        </div>
      </div>

      <div className="p-4 flex justify-center">
        <div id="sale-invoice-print" className="invoice-sheet bg-white text-slate-900 shadow-lg w-full max-w-[210mm]">
          <section className="invoice-band">
            <header className="invoice-header">
              <div className="flex items-center gap-2">
                <img src={logoSrc} alt="" className="w-7 h-7 rounded" />
                <p className="text-sm font-bold leading-tight">FACTURE</p>
              </div>
              <div className="text-right text-[9px] leading-tight">
                <p className="font-semibold">{model.reference}</p>
                <p>{model.dateTime}</p>
              </div>
            </header>

            <div className="px-4">
              <p className="text-[11px] font-bold leading-tight">{model.businessName}</p>
              <p className="text-[8px] text-slate-500">
                {[model.address, model.phone ? `Tél. ${model.phone}` : null].filter(Boolean).join('  ·  ')}
              </p>
              {model.slogan && <p className="text-[8px] italic text-slate-500">« {model.slogan} »</p>}
            </div>

            <div className="px-4 pt-1.5">
              <div className="grid grid-cols-[1fr_28px_70px_70px] gap-2 bg-indigo-50 px-2 py-0.5 text-[8px] font-bold text-indigo-600 rounded">
                <span>ARTICLE ET CARACTÉRISTIQUES</span>
                <span className="text-right">QTÉ</span>
                <span className="text-right">PRIX UNIT.</span>
                <span className="text-right">TOTAL</span>
              </div>
              {model.lines.map((line, idx) => (
                <div key={idx} className="border-b border-slate-200 px-2 py-0.5">
                  <div className="grid grid-cols-[1fr_28px_70px_70px] gap-2 text-[9px] font-semibold">
                    <span>{line.title}</span>
                    <span className="text-right">{line.quantity}</span>
                    <span className="text-right">{line.unitPrice}</span>
                    <span className="text-right">{line.total}</span>
                  </div>
                  {line.specs.length > 0 && (
                    <p className="text-[7.5px] leading-snug text-slate-500">
                      {line.specs.map((s) => `${s.label} : ${s.value}`).join('  ·  ')}
                    </p>
                  )}
                </div>
              ))}
              <div className="flex justify-end gap-5 px-2 pt-1 text-[9px]">
                <span className="font-bold">Total à payer</span>
                <span className="font-bold text-indigo-600">{model.total}</span>
              </div>
            </div>

            <div className="mx-4 mt-1.5 flex items-center gap-3 rounded-lg bg-indigo-50 p-1.5">
              {saleQr && <img src={saleQr} alt="" className="w-14 h-14 rounded bg-white" />}
              <div className="text-[7px] leading-tight">
                <p className="font-bold text-indigo-600">PAYER CETTE FACTURE</p>
                <p className="text-slate-500">Scannez avec ScanLinkPay</p>
              </div>
              <div className="ml-auto text-right text-[7px] leading-tight">
                <p className="text-slate-500">Numéro ScanLinkPay</p>
                <p className="text-[11px] font-bold">{model.scanlinkpayNumber || '—'}</p>
              </div>
            </div>

            {model.footerMessage && (
              <p className="px-4 pt-1 text-center text-[7.5px] italic text-slate-500">{model.footerMessage}</p>
            )}
          </section>
        </div>
      </div>

      <style>{`
        .invoice-sheet { font-family: Helvetica, Arial, sans-serif; }
        .invoice-band { height: 99mm; display: flex; flex-direction: column; gap: 3px; overflow: hidden; padding-top: 0; }
        .invoice-header { background: #4f46e5; color: #fff; display: flex; align-items: center; justify-content: space-between; padding: 5px 16px; margin-bottom: 2px; }
        @media print {
          @page { size: A4; margin: 0; }
          body * { visibility: hidden; }
          #sale-invoice-print, #sale-invoice-print * { visibility: visible; }
          #sale-invoice-print { position: absolute; left: 0; top: 0; width: 210mm; max-width: none; box-shadow: none; }
          .no-print { display: none !important; }
        }
      `}</style>
    </div>
  );
}
