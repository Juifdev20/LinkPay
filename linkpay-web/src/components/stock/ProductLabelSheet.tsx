import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle, Loader2, Printer } from 'lucide-react';
import { FormSheet } from '@/components/FormSheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { buildProductLabel } from '@/lib/printing/build-receipt';
import type { ReceiptLine } from '@/lib/printing/types';
import { PrintFlowStatus, ReceiptPreview, usePrintFlow, type PrintBatch } from '@/components/printing/ReceiptPrint';

/** One run can cover a whole delivery (e.g. 120 bags of rice). */
export const MAX_LABELS = 500;
/** Labels per send — keeps a cheap printer's buffer from overflowing. */
const BATCH_SIZE = 20;

export const clampLabels = (v: string | number) => Math.min(MAX_LABELS, Math.max(1, Math.floor(Number(v)) || 1));

type LabelProduct = { name: string; barcode: string; unit_price_cents: number; currency: string };

/** `count` labels split into batches; batches after the first start with a
 *  separator so the strip reads continuously between sends. */
export function labelBatches(product: LabelProduct, count: number): PrintBatch[] {
  const batches: PrintBatch[] = [];
  for (let start = 0; start < count; start += BATCH_SIZE) {
    const n = Math.min(BATCH_SIZE, count - start);
    const lines: ReceiptLine[] = start > 0 ? [{ type: 'text', text: ' ' }, { type: 'separator' }, { type: 'text', text: ' ' }] : [];
    lines.push(...buildProductLabel(product, n));
    batches.push({ lines, count: n });
  }
  return batches;
}

/**
 * Prints barcode labels to stick on products that have no manufacturer
 * code — on the same thermal printer as the receipts (the printer draws
 * the bars natively, see escpos.ts). As many as the stock needs, in one go.
 */
export function ProductLabelSheet({
  product,
  stockQuantity,
  autoPrintCopies,
  onClose,
}: {
  product: LabelProduct;
  /** Units in stock — offered as a one-tap label count. */
  stockQuantity?: number;
  /** Set right after the product was saved: print this many labels at once. */
  autoPrintCopies?: number;
  onClose: () => void;
}) {
  const [copies, setCopies] = useState(String(autoPrintCopies ?? 1));
  const count = clampLabels(copies);
  const preview = useMemo(() => buildProductLabel(product, 1), [product]);
  const flow = usePrintFlow();
  const jobName = `Etiquette-${product.barcode}`;
  const print = (n: number) => flow.printJob({ batches: labelBatches(product, n), jobName, unit: 'étiquettes' });

  // Once only — React dev mode runs mount effects twice; never print twice.
  const autoPrinted = useRef(false);
  useEffect(() => {
    if (!autoPrintCopies || autoPrinted.current) return;
    autoPrinted.current = true;
    print(autoPrintCopies);
  }, []);

  const { progress } = flow;
  const finished = progress && progress.done === progress.total && !flow.printing;

  return (
    <FormSheet onClose={onClose} title="Étiquette produit">
      <div className="p-6 space-y-4 max-w-sm mx-auto">
        <h2 className="text-xl font-bold text-foreground">Étiquettes produit</h2>
        {!!autoPrintCopies && (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
            Article enregistré — {autoPrintCopies} étiquette{autoPrintCopies > 1 ? 's' : ''} envoyée{autoPrintCopies > 1 ? 's' : ''} à l'imprimante.
          </p>
        )}

        <ReceiptPreview lines={preview} className="w-[260px]" />

        {/* Long runs: live counter */}
        {progress && progress.total > 1 && (
          <div className="space-y-1.5">
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
            <p className="text-xs text-center text-muted-foreground">
              {finished ? `${progress.total} étiquettes imprimées` : `Impression ${progress.done} / ${progress.total}…`}
            </p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="label_copies">Nombre d'étiquettes</Label>
          <Input
            id="label_copies"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_LABELS}
            value={copies}
            onChange={(e) => setCopies(e.target.value)}
          />
          <div className="flex gap-2">
            {!!stockQuantity && stockQuantity > 1 && (
              <button type="button" onClick={() => setCopies(String(Math.min(stockQuantity, MAX_LABELS)))} className="rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-accent">
                = stock actuel ({stockQuantity})
              </button>
            )}
            <button type="button" onClick={() => setCopies('1')} className="rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-accent">
              1 seule
            </button>
          </div>
          {count > 100 && <p className="text-xs text-muted-foreground">Vérifiez qu'il y a assez de papier dans l'imprimante.</p>}
        </div>

        <PrintFlowStatus flow={flow} />

        <Button className="w-full" onClick={() => print(count)} disabled={flow.printing || flow.picking}>
          {flow.printing ? <Loader2 className="mr-2 w-4 h-4 animate-spin" /> : <Printer className="mr-2 w-4 h-4" />}
          {autoPrintCopies ? 'Réimprimer' : 'Imprimer'} {count > 1 ? `${count} étiquettes` : "l'étiquette"}
        </Button>
        {!!autoPrintCopies && (
          <Button variant="outline" className="w-full" onClick={onClose}>Terminer</Button>
        )}
      </div>
    </FormSheet>
  );
}
