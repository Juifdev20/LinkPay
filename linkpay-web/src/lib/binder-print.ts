import api from '@/lib/api';
import { deliverPdf } from '@/lib/report-pdf';
import { buildCashBookPdf, buildCashReportPdf, reportPeriodLabel, type CashPdfMeta } from '@/lib/cash-book-pdf';
import { buildBinderLabelPdf, buildBinderYearPdf } from '@/lib/binder-pdf';
import { MONTHS_FR, monthKey } from '@/lib/binder';

export type PrintPeriod = 'day' | 'week' | 'month' | 'year';
export interface PrintCtx {
  base: string; // /merchants/:id/cash-book
  currency: string;
  meta: CashPdfMeta;
  stationName?: string;
}

const getReport = async (c: PrintCtx, period: PrintPeriod, date: string) => (await api.get(`${c.base}/report`, { params: { period, date, currency: c.currency } })).data;
const getBook = async (c: PrintCtx, month: string) => (await api.get(`${c.base}/month`, { params: { month, currency: c.currency } })).data;

/** Section line printed above the title when the page comes out of a binder. */
const tagOf = (year: number, section: string) => `Classeur ${year} · ${section}`;

/** Prints the report of any day, week, month or year (the server cuts the period; the week runs Monday to Sunday). */
export async function printReport(c: PrintCtx, period: PrintPeriod, date: string) {
  const r = await getReport(c, period, date);
  const year = Number(r.first_day.slice(0, 4));
  const section = { day: 'Journalier', week: 'Hebdomadaire', month: `Mensuel · ${MONTHS_FR[Number(r.first_day.slice(5, 7)) - 1]}`, year: 'Annuel' }[period];
  const doc = buildCashReportPdf(r, { ...c.meta, cashiers: r.cashiers, tag: tagOf(year, section), periodLabel: reportPeriodLabel(r) });
  await deliverPdf(doc, `rapport-${period}-${r.first_day}-${c.currency}.pdf`);
}

/** The cash book of a month (the day-by-day journal), from a binder. */
export async function printMonthBook(c: PrintCtx, year: number, month0: number) {
  const b = await getBook(c, monthKey(year, month0));
  await deliverPdf(buildCashBookPdf(b, { ...c.meta, cashiers: b.cashiers, tag: tagOf(year, `Livre de caisse · ${MONTHS_FR[month0]}`) }), `livre-de-caisse-${b.month}-${c.currency}.pdf`);
}

/** The label to stick on the spine of a real binder. */
export async function printBinderLabel(c: PrintCtx, year: number) {
  await deliverPdf(buildBinderLabelPdf({ year, org: c.meta.org, stationName: c.stationName, currency: c.currency }), `etiquette-classeur-${year}-${c.currency}.pdf`, "Partager l'étiquette");
}

/**
 * The whole binder of a year: cover, contents, annual report, then each month's report and cash book. Loaded month by
 * month (three at a time) so the screen can show a progress bar. Months after today are left out.
 */
export async function printYearBinder(c: PrintCtx, year: number, today: string, onProgress: (done: number, total: number) => void) {
  const lastMonth0 = Number(today.slice(0, 4)) === year ? Number(today.slice(5, 7)) - 1 : 11;
  const months = [...Array(lastMonth0 + 1).keys()];
  const total = months.length * 2 + 1;
  let done = 0;
  const tick = () => onProgress(++done, total);

  const yearReport = await getReport(c, 'year', `${year}-01-01`);
  tick();
  const loaded: { month0: number; report: any; book: any }[] = [];
  for (let i = 0; i < months.length; i += 3) {
    const batch = await Promise.all(months.slice(i, i + 3).map(async (month0) => {
      const key = monthKey(year, month0);
      const [report, book] = await Promise.all([getReport(c, 'month', `${key}-01`).then((x) => { tick(); return x; }), getBook(c, key).then((x) => { tick(); return x; })]);
      return { month0, report, book };
    }));
    loaded.push(...batch);
  }
  const doc = buildBinderYearPdf(
    { year: yearReport, months: loaded },
    { ...c.meta, cashiers: yearReport.cashiers, year, currency: c.currency, to: Number(today.slice(0, 4)) === year ? today : undefined },
  );
  await deliverPdf(doc, `classeur-${year}-${c.currency}.pdf`, 'Partager le classeur');
}
