import { useEffect, useRef, useState } from 'react';
import type { ReceiptLine } from '@/lib/printing/types';
import { barcodeSvg } from '@/lib/printing/html';
import { loadPrinter, printReceipt, savePrinter, type PrinterConfig } from '@/lib/printing/printer';
import { PrinterPicker } from './PrinterPicker';

const Sep = () => <div className="border-t border-dashed border-neutral-400 my-2" />;

function BarcodeImage({ value }: { value: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = barcodeSvg(value, { height: 45 });
  }, [value]);
  return <div ref={ref} className="flex justify-center [&_svg]:max-w-full [&_svg]:h-auto" />;
}

/** Screen rendering of the same lines that go to the printer. */
export function ReceiptPreview({ lines, className = 'w-[300px]' }: { lines: ReceiptLine[]; className?: string }) {
  return (
    <div className={`mx-auto ${className} bg-white text-black font-mono text-[12px] leading-snug p-5 rounded-lg shadow-md border border-neutral-200 space-y-1`}>
      {lines.map((line, i) => {
        switch (line.type) {
          case 'title':
            return <p key={i} className="text-center text-[15px] font-bold uppercase tracking-wide leading-tight">{line.text}</p>;
          case 'subtitle':
            return <p key={i} className="text-center font-semibold">{line.text}</p>;
          case 'text':
            return (
              <p key={i} className={`${line.align === 'center' ? 'text-center' : ''} ${line.small ? 'text-[10px] text-neutral-500' : 'text-[11px]'}`}>
                {line.text}
              </p>
            );
          case 'separator':
            return <Sep key={i} />;
          case 'field':
            return (
              <div key={i} className={`flex justify-between gap-2 ${line.muted ? 'text-[11px] text-neutral-500' : ''}`}>
                <span className={`truncate ${line.muted && line.value === 'annulée' ? 'line-through' : ''}`}>{line.label}</span>
                <span className="flex-shrink-0">{line.value}</span>
              </div>
            );
          case 'amount':
            return (
              <div key={i} className={`flex justify-between gap-2 font-bold ${line.large ? 'text-[15px]' : ''}`}>
                <span>{line.label}</span>
                <span className="flex-shrink-0">{line.value}</span>
              </div>
            );
          case 'barcode':
            return <BarcodeImage key={i} value={line.value} />;
        }
      })}
    </div>
  );
}

/**
 * Printer choice + print action shared by every printable screen (sale
 * receipt, product labels). The printer is picked once per device and
 * remembered; "changer" reopens the picker.
 */
/** A print job: one or more batches sent one after another (a long label
 *  run is split so a small printer's buffer never overflows). */
export type PrintBatch = { lines: ReceiptLine[]; /** units in this batch (labels) */ count: number };
type PrintJob = { batches: PrintBatch[]; jobName: string; unit?: string };

export function usePrintFlow() {
  const [printer, setPrinter] = useState<PrinterConfig | null>(loadPrinter);
  const [picking, setPicking] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Long runs: how many units are already out. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  // Job waiting for the first-time printer choice.
  const queued = useRef<PrintJob | null>(null);

  const run = async (job: PrintJob, config: PrinterConfig) => {
    setError(null);
    setPrinting(true);
    const total = job.batches.reduce((n, b) => n + b.count, 0);
    let done = 0;
    try {
      if (config.kind === 'system' || job.batches.length === 1) {
        // The system dialog prints everything as one document — no batching.
        await printReceipt(job.batches.flatMap((b) => b.lines), config, job.jobName);
        done = total;
      } else {
        setProgress({ done: 0, total });
        for (let i = 0; i < job.batches.length; i++) {
          // Paper is cut once, after the last batch only.
          await printReceipt(job.batches[i].lines, config, job.jobName, { cut: i === job.batches.length - 1 });
          done += job.batches[i].count;
          setProgress({ done, total });
        }
      }
    } catch (e: any) {
      // NotFoundError = the user closed the browser's device chooser.
      if (e?.name !== 'NotFoundError') {
        const msg = e?.message || 'Impression impossible';
        setError(job.batches.length > 1 && done > 0 ? `${msg} — ${done} / ${total} ${job.unit ?? ''} imprimées.` : msg);
      }
    } finally {
      setPrinting(false);
    }
    return done;
  };

  /** Prints a job now, or after the first-time printer choice. */
  const printJob = (job: PrintJob) => {
    setProgress(null);
    if (printer) return run(job, printer);
    queued.current = job;
    setPicking(true);
  };

  const print = (lines: ReceiptLine[], jobName = 'Recu') => printJob({ batches: [{ lines, count: 1 }], jobName });

  const choose = (config: PrinterConfig) => {
    savePrinter(config);
    setPrinter(config);
    setPicking(false);
    const job = queued.current;
    queued.current = null;
    if (job) run(job, config);
  };

  return { printer, picking, setPicking, printing, error, progress, print, printJob, choose };
}

/** Picker (when choosing) or the "Imprimante : X · changer" line, plus errors. */
export function PrintFlowStatus({ flow }: { flow: ReturnType<typeof usePrintFlow> }) {
  const { printer, picking, setPicking, error, choose } = flow;
  return (
    <>
      {picking ? (
        <PrinterPicker initial={printer} onChosen={choose} onCancel={() => setPicking(false)} />
      ) : (
        printer && (
          <p className="text-xs text-muted-foreground text-center">
            Imprimante : <span className="font-medium text-foreground">{printer.name}</span>
            {' · '}{printer.columns === 32 ? '58 mm' : '80 mm'}
            {printer.encoding === 'ascii' && ' · sans accents'}
            {' · '}
            <button onClick={() => setPicking(true)} className="underline hover:text-foreground">changer</button>
          </p>
        )
      )}
      {error && <p className="max-w-sm mx-auto text-sm text-destructive text-center">{error}</p>}
    </>
  );
}
