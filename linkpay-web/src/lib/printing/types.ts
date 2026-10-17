/**
 * Printer-independent receipt model. A receipt is just a list of lines;
 * the same list drives the on-screen preview, the ESC/POS bytes sent to a
 * thermal printer and the plain-text fallback for the browser print dialog.
 */
export type ReceiptLine =
  | { type: 'title'; text: string }
  | { type: 'subtitle'; text: string }
  | { type: 'text'; text: string; align?: 'left' | 'center'; small?: boolean }
  | { type: 'separator' }
  /** Label on the left, value right-aligned. `muted` = voided line. */
  | { type: 'field'; label: string; value: string; muted?: boolean }
  /** Emphasized amount (bold) — totals, change given. */
  | { type: 'amount'; label: string; value: string; large?: boolean }
  /** Printed as real bars (ESC/POS GS k / SVG), digits underneath — product labels. */
  | { type: 'barcode'; value: string };

/** 58mm rolls print 32 characters per line, 80mm rolls 48. */
export type PaperColumns = 32 | 48;

/** 'cp850' keeps accents; 'ascii' strips them and works on any printer. */
export type TextEncoding = 'cp850' | 'ascii';
