import type { PaperColumns, ReceiptLine, TextEncoding } from './types';

// ------------------------------------------------------------------
// Text normalisation. Thermal printers use one byte per character from a
// legacy code page — NOT UTF-8. We select CP850 (Western European, covers
// French accents) and map every character to it. Anything missing from
// CP850 is replaced by a close ASCII equivalent first: the long dash "—"
// and the narrow no-break space Intl puts in "1 000 FC" would otherwise
// come out as "?".
// ------------------------------------------------------------------
const REPLACEMENTS: Record<string, string> = {
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
  '—': '-', '–': '-', '−': '-',
  '‘': "'", '’': "'", '“': '"', '”': '"',
  '…': '...', '×': 'x', '€': 'EUR',
};

const normalize = (s: string) => s.replace(/[    —–−‘’“”…×€]/g, (c) => REPLACEMENTS[c]);

// CP850 upper half (0x80–0xFF) — only the characters French/DRC receipts
// realistically need.
const CP850: Record<string, number> = {
  'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'å': 0x86, 'ç': 0x87,
  'ê': 0x88, 'ë': 0x89, 'è': 0x8a, 'ï': 0x8b, 'î': 0x8c, 'ì': 0x8d, 'Ä': 0x8e, 'Å': 0x8f,
  'É': 0x90, 'æ': 0x91, 'Æ': 0x92, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97,
  'ÿ': 0x98, 'Ö': 0x99, 'Ü': 0x9a, '£': 0x9c, 'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3,
  'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7, '«': 0xae, '»': 0xaf, 'Á': 0xb5, 'Â': 0xb6,
  'À': 0xb7, 'Ê': 0xd2, 'Ë': 0xd3, 'È': 0xd4, 'Í': 0xd6, 'Î': 0xd7, 'Ï': 0xd8, 'Ó': 0xe0,
  'Ô': 0xe2, 'Ò': 0xe3, 'Ú': 0xe9, 'Û': 0xea, 'Ù': 0xeb, '°': 0xf8,
};

function encodeCp850(text: string): number[] {
  const out: number[] = [];
  for (const ch of normalize(text)) {
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code < 0x7f) out.push(code);
    else if (CP850[ch] !== undefined) out.push(CP850[ch]);
    else {
      // Last resort: strip the accent (ő → o), else "?".
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      const b = base.charCodeAt(0);
      out.push(base.length === 1 && b >= 0x20 && b < 0x7f ? b : 0x3f);
    }
  }
  return out;
}

/** Plain ASCII — for the "Generic / Text Only" Windows driver fallback,
 *  which mangles anything outside ASCII. */
export const toAscii = (s: string) =>
  normalize(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, ' ');

// ------------------------------------------------------------------
// Layout: receipt lines → fixed-width rows. Shared by the ESC/POS encoder
// and the plain-text fallback so both print the exact same ticket.
// ------------------------------------------------------------------
/** `barcode` set = a barcode row (text holds its digits for text output). */
export type Row = { text: string; align: 'left' | 'center'; bold?: boolean; tall?: boolean; barcode?: string };

const len = (s: string) => normalize(s).length;

function wrap(text: string, width: number): string[] {
  const words = normalize(text).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const word = w.length > width ? w.slice(0, width) : w;
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= width) cur += ' ' + word;
    else { out.push(cur); cur = word; }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

function leftRight(label: string, value: string, cols: number): string[] {
  const l = normalize(label);
  const v = normalize(value);
  if (l.length + 1 + v.length <= cols) return [l + ' '.repeat(cols - l.length - v.length) + v];
  // Too long for one row: label wraps, value goes right-aligned underneath.
  const rows = wrap(l, cols);
  const last = rows[rows.length - 1];
  if (last.length + 1 + v.length <= cols) {
    rows[rows.length - 1] = last + ' '.repeat(cols - last.length - v.length) + v;
  } else {
    rows.push(' '.repeat(Math.max(0, cols - v.length)) + v.slice(0, cols));
  }
  return rows;
}

export function layout(lines: ReceiptLine[], cols: number): Row[] {
  const rows: Row[] = [];
  for (const line of lines) {
    switch (line.type) {
      case 'title':
        wrap(line.text.toUpperCase(), cols).forEach((t) => rows.push({ text: t, align: 'center', bold: true, tall: true }));
        break;
      case 'subtitle':
        wrap(line.text, cols).forEach((t) => rows.push({ text: t, align: 'center', bold: true }));
        break;
      case 'text':
        wrap(line.text, cols).forEach((t) => rows.push({ text: t, align: line.align || 'left' }));
        break;
      case 'separator':
        rows.push({ text: '-'.repeat(cols), align: 'left' });
        break;
      case 'field':
        leftRight(line.label, line.value, cols).forEach((t) => rows.push({ text: t, align: 'left' }));
        break;
      case 'amount':
        leftRight(line.label, line.value, cols).forEach((t) => rows.push({ text: t, align: 'left', bold: true, tall: line.large }));
        break;
      case 'barcode':
        rows.push({ text: line.value, align: 'center', barcode: line.value });
        break;
    }
  }
  return rows;
}

/**
 * Symbology for a code: EAN-13 / EAN-8 / UPC-A when the digits fit (what
 * packaging and our in-store labels use), Code128 for anything else.
 */
export function barcodeFormat(value: string): 'EAN13' | 'EAN8' | 'UPC' | 'CODE128' {
  if (/^\d{13}$/.test(value)) return 'EAN13';
  if (/^\d{8}$/.test(value)) return 'EAN8';
  if (/^\d{12}$/.test(value)) return 'UPC';
  return 'CODE128';
}

export const pad = (row: Row, cols: number) =>
  row.align === 'center' ? ' '.repeat(Math.max(0, Math.floor((cols - len(row.text)) / 2))) + row.text : row.text;

/** Plain-text ticket (ASCII) for the browser / Windows-driver fallback. */
export function receiptToText(lines: ReceiptLine[], cols: PaperColumns = 32): string {
  const body = layout(lines, cols).map((r) => toAscii(pad(r, cols)));
  // Feed past the tear bar so the next ticket doesn't start under it.
  return [...body, '', '', '', '', '', ''].join('\n');
}

// ------------------------------------------------------------------
// ESC/POS encoder
// ------------------------------------------------------------------
const ESC = 0x1b;
const GS = 0x1d;

/**
 * Native ESC/POS barcode — the printer draws the bars itself (no image to
 * rasterize), digits printed underneath. Module width 2 keeps an EAN-13
 * at ~190 dots, well inside even a 58 mm head (384 dots).
 */
function escPosBarcode(value: string): number[] {
  const out = [
    ESC, 0x61, 1,      // ESC a 1 — centered
    GS, 0x68, 80,      // GS h — bar height (dots)
    GS, 0x77, 2,       // GS w — module width
    GS, 0x48, 2,       // GS H 2 — human-readable digits below
    GS, 0x66, 0,       // GS f 0 — font A for those digits
  ];
  const fmt = barcodeFormat(value);
  const ascii = [...value].map((c) => c.charCodeAt(0) & 0x7f);
  if (fmt === 'EAN13') out.push(GS, 0x6b, 67, 13, ...ascii);       // GS k 67 — EAN13
  else if (fmt === 'EAN8') out.push(GS, 0x6b, 68, 8, ...ascii);    // GS k 68 — EAN8
  else if (fmt === 'UPC') out.push(GS, 0x6b, 65, 12, ...ascii);    // GS k 65 — UPC-A
  else {
    // GS k 73 — CODE128, "{B" selects code set B (printable ASCII).
    const data = [0x7b, 0x42, ...ascii.slice(0, 250)];
    out.push(GS, 0x6b, 73, data.length, ...data);
  }
  out.push(0x0a, ESC, 0x61, 0);
  return out;
}

/**
 * Receipt lines → raw ESC/POS bytes, `cols` characters per row.
 * - 'cp850': accents kept (ESC t 2 = PC850, the Epson numbering most
 *   printers follow).
 * - 'ascii': accents stripped — prints correctly on EVERY ESC/POS printer,
 *   for the few that number their code pages differently.
 */
export function receiptToEscPos(
  lines: ReceiptLine[],
  cols: PaperColumns = 32,
  encoding: TextEncoding = 'cp850',
  /** false = a batch in the middle of a long label run: no feed, no cut —
   *  the next batch continues on the same strip of paper. */
  cut = true,
): Uint8Array {
  const out: number[] = [ESC, 0x40]; // ESC @ — reset
  if (encoding === 'cp850') out.push(ESC, 0x74, 0x02); // ESC t 2 — code page PC850
  const encode = encoding === 'cp850' ? encodeCp850 : (s: string) => [...toAscii(s)].map((c) => c.charCodeAt(0));
  for (const row of layout(lines, cols)) {
    if (row.barcode) {
      out.push(...escPosBarcode(row.barcode));
      continue;
    }
    out.push(ESC, 0x61, row.align === 'center' ? 1 : 0); // ESC a — alignment
    out.push(ESC, 0x45, row.bold ? 1 : 0);              // ESC E — bold
    out.push(GS, 0x21, row.tall ? 0x01 : 0x00);         // GS !  — double height
    out.push(...encode(row.text), 0x0a);
  }
  out.push(ESC, 0x45, 0, GS, 0x21, 0, ESC, 0x61, 0);
  if (cut) {
    out.push(
      ESC, 0x64, 0x04,        // ESC d 4 — feed 4 lines past the cutter
      GS, 0x56, 0x42, 0x00,   // GS V B 0 — partial cut (ignored without cutter)
    );
  }
  return Uint8Array.from(out);
}
