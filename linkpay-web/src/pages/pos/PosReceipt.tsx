import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { FormSheet } from '@/components/FormSheet';
import { CheckCircle, Printer, Loader2 } from 'lucide-react';
import { buildPosReceipt } from '@/lib/printing/build-receipt';
import { PrintFlowStatus, ReceiptPreview, usePrintFlow } from '@/components/printing/ReceiptPrint';

/**
 * The sale receipt — shown right after a ticket is settled and re-openable
 * from the sales history. The ticket is built once as printer-independent
 * lines (lib/printing) and used for the preview, the ESC/POS bytes and the
 * system-print fallback. The printer is picked once per device.
 */
export function PosReceipt({ ticket, onClose }: { ticket: any; onClose: () => void }) {
  const lines = useMemo(() => buildPosReceipt(ticket), [ticket]);
  const flow = usePrintFlow();

  return (
    <FormSheet onClose={onClose} title="Reçu de vente">
      <div className="p-6 space-y-4">
        <div className="flex justify-center">
          <CheckCircle className="w-10 h-10 text-success" />
        </div>

        <ReceiptPreview lines={lines} />

        <PrintFlowStatus flow={flow} />

        <div className="flex gap-3 max-w-sm mx-auto">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => flow.print(lines, `Ticket-${ticket.ticket_number ?? ''}`)}
            disabled={flow.printing || flow.picking}
          >
            {flow.printing ? <Loader2 className="mr-2 w-4 h-4 animate-spin" /> : <Printer className="mr-2 w-4 h-4" />}
            Imprimer
          </Button>
          <Button className="flex-1" onClick={onClose}>Nouvelle vente</Button>
        </div>
      </div>
    </FormSheet>
  );
}
