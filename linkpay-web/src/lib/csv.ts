import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const cell = (v: string | number | null | undefined) => {
  const s = String(v ?? '');
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Cents as a plain decimal for a spreadsheet ("1234.50", dot separator, no currency). */
export const csvAmount = (cents: number) => (Math.round(cents || 0) / 100).toFixed(2);

/**
 * A spreadsheet-friendly CSV (";" separator, UTF-8 with a BOM so Excel reads the accents).
 * On the Android app it goes through the share sheet (a download link does nothing in a WebView).
 */
export async function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const text = '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({ path: filename, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: filename, files: [uri], dialogTitle: 'Partager le fichier' });
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
