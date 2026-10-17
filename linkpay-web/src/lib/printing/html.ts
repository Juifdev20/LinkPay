import JsBarcode from 'jsbarcode';
import type { PaperColumns, ReceiptLine } from './types';
import { barcodeFormat, layout, pad, toAscii } from './escpos';

/** Barcode as an SVG string (screen preview, system print dialog). */
export function barcodeSvg(value: string, opts: { height?: number; width?: number } = {}): string {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const render = (format: string) =>
    JsBarcode(svg, value, {
      format,
      width: opts.width ?? 2,
      height: opts.height ?? 50,
      fontSize: 14,
      margin: 4,
      displayValue: true,
    });
  try {
    render(barcodeFormat(value));
  } catch {
    // e.g. 13 digits with a wrong check digit — still printable as Code128.
    render('CODE128');
  }
  return svg.outerHTML;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Receipt lines → a standalone page for the system print dialog. Text rows
 * stay plain ASCII monospace (thermal "Generic / Text Only" drivers mangle
 * accents and can't lay out HTML columns); barcodes become SVG images.
 */
export function receiptToHtml(lines: ReceiptLine[], cols: PaperColumns = 32): string {
  const body = layout(lines, cols)
    .map((row) =>
      row.barcode
        ? `<div class="bc">${barcodeSvg(row.barcode)}</div>`
        : `<pre>${escapeHtml(toAscii(pad(row, cols)))}</pre>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: 80mm auto; margin: 2mm; }
body { margin: 0; }
/* A receipt cut in half across two pages is worthless — one unbreakable block. */
body { break-inside: avoid; page-break-inside: avoid; orphans: 999; widows: 999; }
pre { font-family: monospace; font-size: 11px; line-height: 1.25; white-space: pre; margin: 0; }
.bc { text-align: center; margin: 4px 0; }
.bc svg { max-width: 100%; height: auto; }
</style></head><body>${body}<pre>\n\n\n\n</pre></body></html>`;
}

/** Prints a standalone page through a hidden iframe — only that page is
 *  printed, whatever screen the app is on. */
export function printHtmlInIframe(html: string): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();
    // Give the SVGs a frame to lay out, then open the dialog. print() blocks
    // until the dialog closes in Chromium; the timeout covers the others.
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        iframe.remove();
        resolve();
      }, 500);
    }, 100);
  });
}
