import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, BookOpen, CheckCircle2, Download, Loader2, Printer, Tag } from 'lucide-react';
import api from '@/lib/api';
import { cn, formatCurrency } from '@/lib/utils';
import {
  MONTHS_SHORT, binderColor, dayShort, daysInMonth, frDate, monthKey, monthName, weeksOfMonth,
} from '@/lib/binder';
import { printBinderLabel, printMonthBook, printReport, printYearBinder, type PrintCtx, type PrintPeriod } from '@/lib/binder-print';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FilterChips } from '@/components/ui/filter-chips';
import { Input } from '@/components/ui/input';

const money = (cents: number, currency: string) => formatCurrency(cents || 0, currency).replace(/[,.]00(?=\D*$)/, '');
const errorText = (e: any) => e?.response?.data?.message || e?.message || 'Impression impossible — réessayez.';

// ------------------------------------------------------------------------------------------------ the shelf

/** The back of a lever-arch binder: coloured cover, cream page edge, metal clamps, white label with writing lines, eyelet. */
function Spine({ year, station, closedDays, selected, onClick }: { year: number; station?: string; closedDays: number; selected: boolean; onClick: () => void }) {
  const col = binderColor(year);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Classeur ${year}`}
      aria-pressed={selected}
      className={cn('relative mt-3 h-[232px] w-[88px] flex-shrink-0 rounded-[3px] transition-transform duration-200', selected ? '-translate-y-2' : 'hover:-translate-y-1')}
      style={{
        background: `linear-gradient(90deg, ${col.dark} 0%, ${col.hex} 14%, ${col.hex} 86%, ${col.dark} 100%)`,
        boxShadow: selected ? `0 14px 24px -8px ${col.hex}aa, 0 0 0 2px hsl(var(--primary))` : '0 10px 18px -10px rgba(0,0,0,.55)',
      }}
    >
      <span className="absolute -top-2 left-[3px] right-[3px] h-2 rounded-t-[3px] bg-[#f3ecd6]" />
      <span className="absolute left-2 top-3 h-[7px] w-5 rounded-sm bg-gradient-to-b from-zinc-300 to-zinc-500" />
      <span className="absolute right-2 top-3 h-[7px] w-5 rounded-sm bg-gradient-to-b from-zinc-300 to-zinc-500" />
      <span
        className="absolute inset-x-[9px] top-[34px] flex h-[138px] flex-col items-center rounded-[2px] bg-white px-1 pt-2 text-center shadow-inner"
        style={{ backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0 17px, #cfd2dc 17px 18px)', backgroundPosition: '0 62px', backgroundSize: '100% 76px', backgroundRepeat: 'no-repeat' }}
      >
        <span className="text-[8px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Classeur</span>
        <span className="text-[26px] font-black leading-none text-[#0a1270]">{year}</span>
        <span className="mt-1 line-clamp-2 w-full text-[9px] font-semibold leading-tight text-[#1e1e28]">{station}</span>
        <span className="mt-1 text-[8px] text-[hsl(var(--muted-foreground))]">{closedDays} j. clôturés</span>
      </span>
      <span
        className="absolute bottom-5 left-1/2 h-9 w-9 -translate-x-1/2 rounded-full"
        style={{ background: 'radial-gradient(circle at 35% 30%, #fff 0 18%, #e9ecf1 19% 38%, #b9bec8 39% 64%, #7b808c 65% 100%)', boxShadow: 'inset 0 -2px 3px rgba(0,0,0,.35)' }}
      />
    </button>
  );
}

// ------------------------------------------------------------------------------------------------ the tab

export function ArchivesTab({ base, currency, ctx, stationName, stationId }: { base: string; currency: string; ctx: PrintCtx; stationName?: string; stationId: string }) {
  const [year, setYear] = useState<number | null>(null);
  const archive = useQuery({
    queryKey: ['cash-archive', stationId, currency],
    queryFn: async () => (await api.get(`${base}/archive`, { params: { currency } })).data,
  });

  if (archive.isLoading) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (archive.isError || !archive.data) return <p className="py-8 text-center text-sm text-destructive">{errorText(archive.error)}</p>;
  const a = archive.data;

  if (year !== null) {
    return <BinderYear year={year} archive={a} base={base} currency={currency} ctx={ctx} onBack={() => setYear(null)} />;
  }
  return (
    <div className="space-y-4">
      <PrintAnyPeriod ctx={ctx} today={a.today} />
      <div>
        <p className="mb-1 text-sm font-semibold text-foreground">Classeurs de la station</p>
        <p className="text-xs text-muted-foreground">Un classeur par année : rapports journaliers, hebdomadaires, mensuels et annuel, rangés dans l'ordre. Touchez un classeur pour l'ouvrir.</p>
      </div>
      <div className="-mx-4 overflow-x-auto px-4 pb-2 pt-3 [scrollbar-width:none] md:mx-0 md:px-0">
        <div className="flex items-end gap-4 border-b-[6px] border-[#c9b38a]/70 pb-0 pt-2">
          {a.years.map((y: any) => (
            <Spine key={y.year} year={y.year} station={stationName} closedDays={y.closed_days} selected={false} onClick={() => setYear(y.year)} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Print the report of any day, week, month or year. */
function PrintAnyPeriod({ ctx, today }: { ctx: PrintCtx; today: string }) {
  const [period, setPeriod] = useState<PrintPeriod>('day');
  const [date, setDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hint = { day: 'Le jour choisi', week: 'La semaine (lundi → dimanche) qui contient cette date', month: 'Le mois qui contient cette date', year: "L'année qui contient cette date" }[period];
  const run = async () => {
    setBusy(true); setError('');
    try { await printReport(ctx, period, date); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Card className="space-y-3 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><Printer className="h-4 w-4 text-primary" /> Imprimer un rapport</p>
      <FilterChips label="Type de rapport" value={period} onChange={setPeriod} options={[{ value: 'day', label: 'Jour' }, { value: 'week', label: 'Semaine' }, { value: 'month', label: 'Mois' }, { value: 'year', label: 'Année' }]} />
      <div className="flex gap-2">
        <Input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date du rapport" />
        <Button disabled={busy || !date} onClick={run}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Download className="mr-1.5 h-4 w-4" /> PDF</>}</Button>
      </div>
      <p className="text-xs text-muted-foreground">{hint}.</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------ an open binder

type Section = 'year' | number; // 'year' or a month index 0–11

function BinderYear({ year, archive, base, currency, ctx, onBack }: { year: number; archive: any; base: string; currency: string; ctx: PrintCtx; onBack: () => void }) {
  const col = binderColor(year);
  const today: string = archive.today;
  const currentYear = Number(today.slice(0, 4));
  const lastMonth0 = year === currentYear ? Number(today.slice(5, 7)) - 1 : 11;
  const [section, setSection] = useState<Section>(year === currentYear ? lastMonth0 : 'year');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<[number, number] | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setError('');
    try { await fn(); } catch (e) { setError(errorText(e)); } finally { setBusy(null); setProgress(null); }
  };

  const yearReport = useQuery({
    queryKey: ['cash-binder-year', base, currency, year],
    queryFn: async () => (await api.get(`${base}/report`, { params: { period: 'year', date: `${year}-01-01`, currency } })).data,
  });
  const yr = yearReport.data;
  const byMonth = useMemo(() => new Map<string, any>((yr?.series || []).map((s: any) => [s.key, s])), [yr]);
  const closedByMonth = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of yr?.closings || []) if (c.status === 'closed') m.set(c.day.slice(0, 7), (m.get(c.day.slice(0, 7)) || 0) + 1);
    return m;
  }, [yr]);

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-primary"><ArrowLeft className="h-4 w-4" /> Tous les classeurs</button>

      <div className="overflow-hidden rounded-2xl border border-border" style={{ boxShadow: `0 8px 20px -12px ${col.hex}` }}>
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: `linear-gradient(90deg, ${col.dark}, ${col.hex})`, color: col.ink }}>
          <BookOpen className="h-6 w-6 flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-extrabold leading-tight">Classeur {year}</p>
            <p className="truncate text-xs opacity-85">{ctx.stationName} · caisse {currency} · du 01/01/{year} au {year === currentYear ? frDate(today) : `31/12/${year}`}</p>
          </div>
        </div>
        {/* Dividers (intercalaires): the year, then the twelve months. */}
        <div role="tablist" aria-label="Intercalaires" className="flex gap-1 overflow-x-auto bg-[#f3ecd6] px-2 pt-2 [scrollbar-width:none]">
          {(['year', ...MONTHS_SHORT.map((_, i) => i)] as Section[]).map((s) => {
            const selected = s === section;
            const future = s !== 'year' && s > lastMonth0;
            return (
              <button
                key={String(s)}
                type="button"
                role="tab"
                aria-selected={selected}
                disabled={future}
                onClick={() => setSection(s)}
                className={cn('relative -mb-px flex-shrink-0 rounded-t-lg border border-b-0 px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-35', selected ? 'bg-card text-foreground' : 'border-transparent text-black/70')}
                style={selected ? { borderColor: col.hex, borderTopWidth: 3 } : { background: `${col.hex}33` }}
              >
                {s === 'year' ? 'Année' : MONTHS_SHORT[s]}
              </button>
            );
          })}
        </div>
      </div>

      {error && <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}

      {section === 'year' ? (
        <div className="space-y-3">
          {yearReport.isLoading || !yr ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Tile label="Chiffre d'affaires" value={money(yr.turnover_cents, currency)} />
                <Tile label="Encaissé en espèces" value={money(yr.cash_sales_cents + yr.cash_in_cents, currency)} tone="in" />
                <Tile label="Dépenses et sorties" value={money(yr.expenses_cents + yr.cash_out_cents, currency)} tone="out" />
                <Tile label="Écarts de caisse" value={money(yr.discrepancy_cents, currency)} />
              </div>
              <Card className="space-y-3 p-4">
                <p className="text-sm font-semibold text-foreground">Imprimer</p>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={!!busy} onClick={() => run('year', () => printReport(ctx, 'year', `${year}-01-01`))}>
                    {busy === 'year' ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Printer className="mr-1.5 h-4 w-4" /> Rapport annuel</>}
                  </Button>
                  <Button variant="outline" disabled={!!busy} onClick={() => run('binder', () => printYearBinder(ctx, year, today, (d, t) => setProgress([d, t])))}>
                    {busy === 'binder' ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> {progress ? `${progress[0]} / ${progress[1]}` : 'Préparation…'}</> : <><BookOpen className="mr-1.5 h-4 w-4" /> Classeur complet</>}
                  </Button>
                  <Button variant="outline" disabled={!!busy} onClick={() => run('label', () => printBinderLabel(ctx, year))}>
                    <Tag className="mr-1.5 h-4 w-4" /> Étiquette de dos
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Le classeur complet réunit couverture, sommaire, rapport annuel puis, mois par mois, le rapport mensuel et le livre de caisse (journal jour par jour). L'étiquette de dos se colle sur un vrai classeur.</p>
              </Card>
              <Card className="overflow-hidden">
                <div className="border-b border-border bg-secondary px-4 py-2 text-xs font-medium text-muted-foreground">Les mois du classeur</div>
                <ul className="divide-y divide-border">
                  {MONTHS_SHORT.map((_, i) => {
                    const key = monthKey(year, i);
                    const s = byMonth.get(key);
                    const future = i > lastMonth0;
                    return (
                      <li key={key}>
                        <button type="button" disabled={future} onClick={() => setSection(i)} className="flex w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-40">
                          <span className="w-24 flex-shrink-0 text-sm font-semibold capitalize">{monthName(year, i).split(' ')[0]}</span>
                          <span className="min-w-0 flex-1 text-xs text-muted-foreground">{future ? 'à venir' : `${closedByMonth.get(key) || 0} jour(s) clôturé(s)`}</span>
                          <span className="flex-shrink-0 text-right text-xs">
                            <span className="block font-semibold text-emerald-600">+{money((s?.cash_sales_cents || 0) + (s?.cash_in_cents || 0), currency)}</span>
                            <span className="block text-rose-500">−{money((s?.expenses_cents || 0) + (s?.cash_out_cents || 0), currency)}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </>
          )}
        </div>
      ) : (
        <MonthSection year={year} month0={section} base={base} currency={currency} ctx={ctx} today={today} busy={busy} run={run} />
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'in' | 'out' }) {
  return (
    <Card className="p-3">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-base font-bold', tone === 'in' ? 'text-emerald-600' : tone === 'out' ? 'text-rose-500' : 'text-foreground')}>{value}</p>
    </Card>
  );
}

// ------------------------------------------------------------------------------------------------ a month: weeks, then days

function MonthSection({ year, month0, base, currency, ctx, today, busy, run }: { year: number; month0: number; base: string; currency: string; ctx: PrintCtx; today: string; busy: string | null; run: (k: string, fn: () => Promise<void>) => void }) {
  const key = monthKey(year, month0);
  const q = useQuery({
    queryKey: ['cash-binder-month', base, currency, key],
    queryFn: async () => (await api.get(`${base}/report`, { params: { period: 'month', date: `${key}-01`, currency } })).data,
  });
  const r = q.data;
  const seriesByDay = useMemo(() => new Map<string, any>((r?.series || []).map((s: any) => [s.key, s])), [r]);
  const closedDays = useMemo(() => new Set<string>((r?.closings || []).filter((c: any) => c.status === 'closed').map((c: any) => c.day)), [r]);
  const unclosed = useMemo(() => new Set<string>(r?.unclosed_days || []), [r]);
  const weeks = useMemo(() => weeksOfMonth(year, month0), [year, month0]);
  const cash = (s?: any) => (s ? s.cash_sales_cents + s.cash_in_cents : 0);
  const out = (s?: any) => (s ? s.expenses_cents + s.cash_out_cents : 0);

  if (q.isLoading || !r) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (q.isError) return <p className="py-6 text-center text-sm text-destructive">{errorText(q.error)}</p>;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Tile label="Encaissé" value={money(r.cash_sales_cents + r.cash_in_cents, currency)} tone="in" />
        <Tile label="Dépensé" value={money(r.expenses_cents + r.cash_out_cents, currency)} tone="out" />
        <Tile label="Écarts" value={money(r.discrepancy_cents, currency)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!!busy} onClick={() => run(`m${key}`, () => printReport(ctx, 'month', `${key}-01`))}>
          {busy === `m${key}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Printer className="mr-1.5 h-4 w-4" /> Rapport mensuel</>}
        </Button>
        <Button variant="outline" disabled={!!busy} onClick={() => run(`b${key}`, () => printMonthBook(ctx, year, month0))}>
          {busy === `b${key}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <><BookOpen className="mr-1.5 h-4 w-4" /> Livre de caisse</>}
        </Button>
      </div>

      {weeks.map((w) => {
        const days = w.days.filter((d) => d <= today);
        if (!days.length) return null;
        const tot = days.reduce((s, d) => ({ cash: s.cash + cash(seriesByDay.get(d)), out: s.out + out(seriesByDay.get(d)) }), { cash: 0, out: 0 });
        return (
          <Card key={w.monday} className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border bg-secondary px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-foreground">Semaine du {frDate(w.monday).slice(0, 5)} au {frDate(w.sunday).slice(0, 5)}</p>
                <p className="text-[11px] text-muted-foreground"><span className="text-emerald-600">+{money(tot.cash, currency)}</span> · <span className="text-rose-500">−{money(tot.out, currency)}</span></p>
              </div>
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run(`w${w.monday}`, () => printReport(ctx, 'week', w.monday))} aria-label={`Imprimer la semaine du ${w.monday}`}>
                {busy === `w${w.monday}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              </Button>
            </div>
            <ul className="divide-y divide-border">
              {days.map((d) => {
                const s = seriesByDay.get(d);
                const active = !!s && (s.cash_sales_cents || s.cash_in_cents || s.non_cash_cents || s.expenses_cents || s.cash_out_cents);
                const closed = closedDays.has(d);
                return (
                  <li key={d} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium capitalize text-foreground">{dayShort(d)}</p>
                      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        {closed ? <><CheckCircle2 className="h-3 w-3 text-emerald-600" /> Clôturée</> : unclosed.has(d) ? <><AlertTriangle className="h-3 w-3 text-amber-600" /> Non clôturée</> : active ? 'En cours' : 'Aucune activité'}
                      </p>
                    </div>
                    <div className="flex-shrink-0 text-right text-xs">
                      <span className="block font-semibold text-emerald-600">{active ? `+${money(cash(s), currency)}` : '—'}</span>
                      {active && out(s) > 0 && <span className="block text-rose-500">−{money(out(s), currency)}</span>}
                    </div>
                    <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run(`d${d}`, () => printReport(ctx, 'day', d))} aria-label={`Imprimer le ${d}`}>
                      {busy === `d${d}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      })}
      <p className="text-center text-[11px] text-muted-foreground">{daysInMonth(year, month0)} jours · classés du premier au dernier jour du mois.</p>
    </div>
  );
}
