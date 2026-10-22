import { useMemo } from 'react';
import { CheckCircle, FileText, Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormSheet } from '@/components/FormSheet';
import { buildSaleReceipt } from '@/lib/printing/build-receipt';
import { PrintFlowStatus, ReceiptPreview, usePrintFlow } from '@/components/printing/ReceiptPrint';
import type { InvoiceOrg, InvoiceSale } from '@/lib/sale-invoice';

/**
 * The ticket of a Ventes sale — the same thermal ticket and the same printer as the supermarket till
 * (lib/printing), with the IMEI / serial number and the warranty under each article. The A4 invoice stays one tap
 * away for the customers who ask for one.
 */
export function SaleReceipt({
  org,
  sale,
  stationName,
  onInvoice,
  onClose,
  closeLabel = 'Nouvelle vente',
}: {
  org: InvoiceOrg;
  sale: InvoiceSale;
  stationName?: string | null;
  onInvoice: () => void;
  onClose: () => void;
  closeLabel?: string;
}) {
  const lines = useMemo(() => buildSaleReceipt(org, sale, stationName), [org, sale, stationName]);
  const flow = usePrintFlow();
  const paid = sale.status === 'PAID';

  return (
    <FormSheet onClose={onClose} title={paid ? 'Reçu de vente' : 'Ticket de vente'} size="narrow">
      <div className="p-6 space-y-4">
        {paid && (
          <div className="flex justify-center">
            <CheckCircle className="w-10 h-10 text-success" />
          </div>
        )}

        <ReceiptPreview lines={lines} />

        <PrintFlowStatus flow={flow} />

        <div className="max-w-sm mx-auto space-y-3">
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => flow.print(lines, `Vente-${sale.reference}`)}
              disabled={flow.printing || flow.picking}
            >
              {flow.printing ? <Loader2 className="mr-2 w-4 h-4 animate-spin" /> : <Printer className="mr-2 w-4 h-4" />}
              Imprimer
            </Button>
            <Button className="flex-1" onClick={onClose}>{closeLabel}</Button>
          </div>
          <button
            onClick={onInvoice}
            className="w-full flex items-center justify-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <FileText className="w-4 h-4" /> Facture A4 (garantie)
          </button>
        </div>
      </div>
    </FormSheet>
  );
}
