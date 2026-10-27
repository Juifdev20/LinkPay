import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowDownLeft, ArrowUpRight, BookOpen, CheckCircle2, ChevronLeft, ChevronRight, Download, FileSpreadsheet,
  Loader2, Lock, LockOpen, Receipt, Scale, Wallet,
} from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useStationScope, resolveStation } from '@/lib/station-scope';
import { cn, formatCurrency } from '@/lib/utils';
import { deliverPdf } from '@/lib/report-pdf';
import { buildCashBookPdf, buildCashReportPdf, buildClosingPdf } from '@/lib/cash-book-pdf';
import { csvAmount, downloadCsv } from '@/lib/csv';
import { PageHeader } from '@/components/PageHeader';
import { StationChips } from '@/components/StationChips';
import { FormSheet } from '@/components/FormSheet';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FilterChips } from '@/components/ui/filter-chips';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SecretForm } from '@/components/cash/SecretForm';
import { ArchivesTab } from '@/components/cash/Binders';
import { useCashUnlockPrompt } from '@/lib/cash-unlock-prompt';

type Currency = 'CDF' | 'USD';
type Tab = 'today' | 'book' | 'reports' | 'archives' | 'expenses';
type Period = 'day' | 'week' | 'month' | 'year';

const EXPENSE_CATEGORIES = ['Transport', 'Achat de fournitures', 'Réparation / entretien', 'Électricité / eau', 'Salaire / avance', 'Repas', 'Communication', 'Autres'];
const KIND_LABELS: Record<string, string> = { sale: 'Vente', cash_in: 'Entrée de caisse', expense: 'Dépense', cash_out: 'Sortie de caisse', adjustment: 'Écart de caisse' };
const STATUS_LABELS: Record<string, string> = { pending: 'En attente — non déduite', approved: 'Validée — sortie de caisse', rejected: 'Rejetée — non déduite' };

/** Whole units where the amount is round: a cash desk reads better without ",00". */
const money = (cents: number, currency: string) => formatCurrency(cents || 0, currency).replace(/[,.]00(?=\D*$)/, '');
const errorText = (e: any, fallback: string) => e?.response?.data?.message || fallback;
const hour = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '');
const dayLabel = (key: string, long = true) => new Date(`${key}T12:00:00`).toLocaleDateString('fr-FR', long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short' });
const monthLabel = (key: string) => new Date(`${key}-15T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
const toCents = (text: string) => Math.round(parseFloat(text.replace(/\s/g, '').replace(',', '.')) * 100);

/** Pure calendar arithmetic on day keys: the phone's clock never decides which day it is (the server does). */
function addDays(key: string, days: number) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
const addMonths = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
};

/**
 * « Caisse & clôture » — the cash book of ONE station, for its seller / cashier (one role), the manager,
 * the accountant (read only) and the owner (picks the station). Today's journal, the daily closing that
 * locks the day, the monthly cash book (opening and closing balance), reports and the station's expenses.
 * Bookkeeping only: nothing here moves money.
 */
export default function CaissePage() {
  const user = useAuthStore((s) => s.user);
  const role = user?.acting_as_org_id ? 'enterprise' : user?.role || '';
  const canWrite = ['enterprise', 'gerant', 'caissier', 'vendeur'].includes(role);
  const isManager = ['enterprise', 'gerant'].includes(role);
  const queryClient = useQueryClient();
  const scope = useStationScope();

  const [tab, setTab] = useState<Tab>('today');
  const [currency, setCurrency] = useState<Currency>(() => {
    try { return localStorage.getItem('pos-currency') === 'USD' ? 'USD' : 'CDF'; } catch { return 'CDF'; }
  });
  const [date, setDate] = useState<string | null>(null); // null = today (decided by the server)
  const [month, setMonth] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('week');
  const [anchor, setAnchor] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [reopenFor, setReopenFor] = useState<any | null>(null);
  const [secretOpen, setSecretOpen] = useState(false);
  const askUnlock = useCashUnlockPrompt((s) => s.ask);

  const { data: org } = useQuery({ queryKey: ['my-organization'], queryFn: async () => (await api.get('/organizations/me')).data });
  const { data: stations } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data as { id: string; name: string }[],
    enabled: !!org?.id,
  });
  // A staff member only gets their own station back; the owner picks one.
  const stationId = useMemo(() => {
    if (!stations?.length) return null;
    if (stations.length === 1) return stations[0].id;
    return resolveStation(scope.stationId, stations) || stations[0].id;
  }, [stations, scope.stationId]);
  const station = stations?.find((s) => s.id === stationId);
  const base = `/merchants/${stationId}/cash-book`;
  // Identity printed on the PDF reports; the signed-in seller / cashier signs as themselves (else the station's cashiers).
  const pdfMeta = {
    org,
    stationName: station?.name,
    signer: ['caissier', 'vendeur'].includes(role) && user?.full_name ? user.full_name.replace(/\s+/g, ' ').trim() : null,
  };

  const refresh = () => {
    for (const key of ['cash-day', 'cash-month', 'cash-report', 'cash-expenses', 'cash-unlock-events']) queryClient.invalidateQueries({ queryKey: [key] });
  };

  const day = useQuery({
    queryKey: ['cash-day', stationId, date, currency],
    queryFn: async () => (await api.get(`${base}/day`, { params: { date: date || undefined, currency } })).data,
    enabled: !!stationId && (tab === 'today' || tab === 'expenses' || !date),
    refetchOnMount: 'always',
  });
  const todayKey: string | null = date === null ? day.data?.day || null : null;

  const book = useQuery({
    queryKey: ['cash-month', stationId, month, currency],
    queryFn: async () => (await api.get(`${base}/month`, { params: { month: month || undefined, currency } })).data,
    enabled: !!stationId && tab === 'book',
  });
  const report = useQuery({
    queryKey: ['cash-report', stationId, period, anchor, currency],
    queryFn: async () => (await api.get(`${base}/report`, { params: { period, date: anchor || undefined, currency } })).data,
    enabled: !!stationId && tab === 'reports',
  });
  const expenses = useQuery({
    queryKey: ['cash-expenses', stationId],
    queryFn: async () => (await api.get(`${base}/expenses`)).data as any[],
    enabled: !!stationId && tab === 'expenses',
  });

  const setCur = (c: Currency) => {
    setCurrency(c);
    try { localStorage.setItem('pos-currency', c); } catch { /* not remembered */ }
  };

  if (!org || !stations) {
    return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (!stationId) {
    return (
      <div className="mx-auto max-w-3xl p-4 pb-28 md:p-6">
        <PageHeader title="Caisse & clôture" />
        <EmptyState icon={Wallet} title="Aucune station" text="Créez ou rejoignez une station pour tenir sa caisse." />
      </div>
    );
  }

  const tabs: { value: Tab; label: string; badge?: number }[] = [
    { value: 'today', label: 'Aujourd’hui' },
    { value: 'book', label: 'Livre de caisse' },
    { value: 'reports', label: 'Rapports' },
    { value: 'archives', label: 'Classeurs' },
    { value: 'expenses', label: 'Dépenses', badge: day.data?.pending_expenses || undefined },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-28 md:p-6 md:pb-6 lg:max-w-5xl">
      <PageHeader title="Caisse & clôture" />

      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-foreground">{station?.name}</p>
        <div className="flex flex-shrink-0 gap-1.5">
          {(['CDF', 'USD'] as const).map((c) => (
            <button key={c} onClick={() => setCur(c)} className={cn('rounded-full border px-3 py-1 text-sm font-medium transition-colors', currency === c ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground')}>{c}</button>
          ))}
        </div>
      </div>
      <StationChips stations={stations} value={stationId} onChange={(id) => scope.setStation(id)} allowAll={false} />
      <FilterChips label="Sections de la caisse" value={tab} onChange={setTab} options={tabs.map((t) => ({ value: t.value, label: t.label, count: t.badge }))} />

      {tab === 'today' && (
        <TodayTab
          q={day} currency={currency} canWrite={canWrite} isManager={isManager} stationName={station?.name} pdfMeta={pdfMeta}
          onDate={setDate} onClose={() => setClosing(true)} onReopen={(c: any) => setReopenFor(c)} onExpense={() => setExpenseOpen(true)}
          onUnlock={(c: any) => askUnlock({ merchantId: stationId!, closingId: c.id }).then((ok) => ok && refresh())}
          onSecret={() => setSecretOpen(true)} stationId={stationId} base={base}
        />
      )}
      {tab === 'book' && <BookTab q={book} currency={currency} onMonth={setMonth} pdfMeta={pdfMeta} />}
      {tab === 'reports' && <ReportsTab q={report} currency={currency} period={period} onPeriod={(p: Period) => { setPeriod(p); setAnchor(null); }} onAnchor={setAnchor} todayKey={todayKey || day.data?.day || null} pdfMeta={pdfMeta} stationName={station?.name} />}
      {tab === 'archives' && <ArchivesTab base={base} currency={currency} stationId={stationId} stationName={station?.name} ctx={{ base, currency, meta: pdfMeta, stationName: station?.name }} />}
      {tab === 'expenses' && (
        <ExpensesTab q={expenses} canWrite={canWrite} isManager={isManager} base={base} onChanged={refresh} onNew={() => setExpenseOpen(true)} />
      )}

      {closing && day.data && (
        <CloseSheet data={day.data} currency={currency} base={base} pdfMeta={pdfMeta} onDone={() => { setClosing(false); refresh(); }} onCancel={() => setClosing(false)} />
      )}
      {expenseOpen && <ExpenseSheet currency={currency} base={base} isManager={isManager} onDone={() => { setExpenseOpen(false); refresh(); }} onCancel={() => setExpenseOpen(false)} />}
      {secretOpen && (
        <FormSheet onClose={() => setSecretOpen(false)} title="Code secret de déverrouillage">
          <SecretForm change={!!day.data?.secret_set} merchantId={stationId!} onDone={() => { setSecretOpen(false); refresh(); }} />
        </FormSheet>
      )}
      {reopenFor && <ReopenSheet closing={reopenFor} base={base} onDone={() => { setReopenFor(null); refresh(); }} onCancel={() => setReopenFor(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- today

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'in' | 'out' }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-base font-bold [overflow-wrap:anywhere]', tone === 'in' && 'text-emerald-600 dark:text-emerald-400', tone === 'out' && 'text-rose-500')}>{value}</p>
    </div>
  );
}

function TodayTab({ q, currency, canWrite, isManager, pdfMeta, stationId, base, onDate, onClose, onReopen, onExpense, onUnlock, onSecret }: any) {
  const d = q.data;
  if (q.isLoading || !d) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (q.isError) return <p className="py-8 text-center text-sm text-destructive">{errorText(q.error, 'Impossible de charger la caisse.')}</p>;

  const blocked: string | null = d.blocked_by;
  const blockedText =
    blocked === 'open_session' ? 'Une session de caisse est encore ouverte : fermez-la (comptage du tiroir) avant de clôturer la journée.'
    : blocked?.startsWith('earlier_day:') ? `Clôturez d'abord la journée du ${dayLabel(blocked.split(':')[1], false)}.`
    : blocked === 'future' ? "Ce jour n'est pas encore arrivé."
    : null;
  const closing = d.closing;

  return (
    <div className="space-y-4">
      {d.previous_unclosed_day && (
        <Card className="space-y-2 border-rose-500/40 bg-rose-500/10 p-4">
          <p className="flex items-start gap-2 text-sm font-semibold text-rose-600 dark:text-rose-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>La journée du {dayLabel(d.previous_unclosed_day, false)} n’est pas clôturée. Les opérations d’aujourd’hui (ventes, dépenses, caisse) sont refusées tant qu’elle ne l’est pas.</span>
          </p>
          <Button size="sm" onClick={() => onDate(d.previous_unclosed_day)}><Scale className="mr-1.5 h-4 w-4" /> Clôturer la journée du {dayLabel(d.previous_unclosed_day, false)}</Button>
        </Card>
      )}

      <div className="flex items-center justify-between gap-2">
        <button className="rounded-full p-2 hover:bg-accent" aria-label="Jour précédent" onClick={() => onDate(addDays(d.day, -1))}><ChevronLeft className="h-5 w-5" /></button>
        <div className="text-center">
          <p className="text-sm font-semibold capitalize">{dayLabel(d.day)}</p>
          {!d.is_today && <button className="text-xs text-primary" onClick={() => onDate(null)}>Revenir à aujourd'hui</button>}
        </div>
        <button className="rounded-full p-2 hover:bg-accent disabled:opacity-30" aria-label="Jour suivant" disabled={d.is_today} onClick={() => onDate(addDays(d.day, 1))}><ChevronRight className="h-5 w-5" /></button>
      </div>

      <div className="rounded-3xl bg-brand-gradient p-5 text-primary-foreground shadow-brand">
        <p className="text-[13px] font-semibold text-primary-foreground/90">{d.closed ? 'Espèces comptées à la clôture' : 'Caisse théorique (espèces)'}</p>
        <p className="mt-2 text-[30px] font-extrabold leading-tight tracking-tight">{money(d.closed ? closing.counted_cents : d.expected_cents, currency)}</p>
        <p className="mt-1 text-xs text-primary-foreground/75">Ouverture {money(d.opening_cents, currency)} + encaissé {money(d.receipts_cents, currency)} − sorti {money(d.payments_cents, currency)}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Solde d'ouverture" value={money(d.opening_cents, currency)} />
        <Stat label="Encaissements" value={money(d.receipts_cents, currency)} tone="in" />
        <Stat label="Décaissements" value={money(d.payments_cents, currency)} tone="out" />
        <Stat label="Hors caisse (ScanLinkPay…)" value={money(d.non_cash_cents, currency)} />
      </div>

      {d.closed ? (
        <Card className="space-y-2 border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="flex items-start gap-2">
            <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold text-foreground">Journée clôturée à {hour(closing.closed_at)}</p>
              <p className="text-muted-foreground">
                Attendu {money(closing.expected_cents, currency)} · compté {money(closing.counted_cents, currency)} ·{' '}
                <span className={cn('font-semibold', closing.discrepancy_cents === 0 ? 'text-emerald-600' : 'text-rose-500')}>
                  {closing.discrepancy_cents === 0 ? 'caisse juste' : `écart ${closing.discrepancy_cents > 0 ? '+' : ''}${money(closing.discrepancy_cents, currency)}`}
                </span>
              </p>
              {closing.note && <p className="mt-1 text-xs text-muted-foreground">Note : {closing.note}</p>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => deliverPdf(buildClosingPdf(closing, { ...pdfMeta, cashiers: d.cashiers }), `cloture-${closing.business_day}.pdf`)}>
              <Download className="mr-1.5 h-4 w-4" /> Reçu de clôture (PDF)
            </Button>
            {isManager && <Button variant="outline" size="sm" onClick={() => onReopen(closing)}><LockOpen className="mr-1.5 h-4 w-4" /> Rouvrir</Button>}
          </div>
          {canWrite && d.is_today && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-sm text-foreground">Boutique fermée : aucune vente n’est possible. Urgence ? Déverrouillez avec votre code secret et un motif (tracé).</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => onUnlock(closing)}><LockOpen className="mr-1.5 h-4 w-4" /> Déverrouiller (urgence)</Button>
            </div>
          )}
        </Card>
      ) : (
        canWrite && (
          <Card className="space-y-2 p-4">
            {closing?.status === 'reopened' && (
              <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                <LockOpen className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>Caisse déverrouillée{closing.reopened_at ? ` à ${hour(closing.reopened_at)}` : ''} ({closing.reopen_reason || 'réouverture'}). Après la vente, clôturez de nouveau la journée.</span>
              </p>
            )}
            {d.secret_set === false && (
              <p className="flex items-start gap-2 rounded-xl bg-primary/5 p-3 text-sm text-foreground">
                <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                <span>Avant de clôturer, créez votre code secret de déverrouillage (pour vendre en cas d’urgence). <button className="font-semibold text-primary underline" onClick={onSecret}>Créer mon code</button></span>
              </p>
            )}
            {blockedText && (
              <p className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /> {blockedText}</p>
            )}
            {blocked?.startsWith('earlier_day:') && (
              <Button size="sm" variant="outline" onClick={() => onDate(blocked.split(':')[1])}>Aller à la journée du {dayLabel(blocked.split(':')[1], false)}</Button>
            )}
            <div className="flex flex-wrap gap-2">
              <Button disabled={!d.can_close || d.secret_set === false} onClick={onClose}><Scale className="mr-2 h-4 w-4" /> Clôturer la caisse</Button>
              <Button variant="outline" onClick={onExpense}><Receipt className="mr-2 h-4 w-4" /> Dépense</Button>
            </div>
            <p className="text-xs text-muted-foreground">Comptez les espèces de la caisse : la journée est ensuite verrouillée et alimente les rapports.</p>
          </Card>
        )
      )}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border bg-secondary px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>Journal de caisse</span><span>Solde</span>
        </div>
        {!d.entries.length ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Aucun mouvement de caisse ce jour-là.</p>
        ) : (
          <ul className="divide-y divide-border">
            {d.entries.map((e: any) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                <span className={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full', e.direction === 'in' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-500')}>
                  {e.direction === 'in' ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{KIND_LABELS[e.kind]}{e.label && e.kind !== 'sale' ? ` · ${e.label}` : e.ref ? ` · ${e.ref}` : ''}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {hour(e.at)}{e.by ? ` · ${e.by}` : ''}
                  </p>
                </div>
                <div className="flex-shrink-0 text-right">
                  <p className={cn('text-sm font-bold', e.direction === 'in' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500')}>{e.direction === 'in' ? '+' : '−'}{money(e.amount_cents, currency)}</p>
                  <p className="text-[11px] text-muted-foreground">{money(e.balance_cents, currency)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {d.pending_expenses_list?.length > 0 && (
        <Card className="overflow-hidden border-amber-500/30">
          <div className="flex items-center justify-between border-b border-border bg-amber-500/10 px-4 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
            <span>Dépenses en attente de validation ({d.pending_expenses_list.length})</span><span>Non déduites</span>
          </div>
          <ul className="divide-y divide-border">
            {d.pending_expenses_list.map((p: any) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{p.category ? `${p.category} · ` : ''}{p.description}</p>
                  <p className="truncate text-xs text-muted-foreground">{hour(p.at)}{p.by ? ` · ${p.by}` : ''}</p>
                </div>
                <span className="flex-shrink-0 font-semibold text-muted-foreground">{money(p.amount_cents, currency)}</span>
              </li>
            ))}
          </ul>
          <p className="px-4 py-2 text-xs text-muted-foreground">
            {isManager ? 'À valider dans l’onglet Dépenses : elle sortira alors de la caisse.' : 'Elle sera déduite de la caisse quand le gérant ou le patron l’aura validée ; vous serez notifié.'}
          </p>
        </Card>
      )}

      <UnlockHistory base={base} stationId={stationId} canWrite={canWrite} secretSet={d.secret_set} onSecret={onSecret} />

      {d.non_cash.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-border bg-secondary px-4 py-2 text-xs font-medium text-muted-foreground">Ventes hors caisse (jamais comptées dans les espèces)</div>
          <ul className="divide-y divide-border">
            {d.non_cash.map((n: any) => (
              <li key={n.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 truncate">{n.label} <span className="text-xs text-muted-foreground">· {hour(n.at)} · {n.method}</span></span>
                <span className="flex-shrink-0 font-semibold">{money(n.amount_cents, currency)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

const UNLOCK_ACTIONS: Record<string, string> = {
  unlock: 'Caisse déverrouillée', failed_attempt: 'Code incorrect', blocked: 'Déverrouillage bloqué (trop d’essais)',
  secret_set: 'Code secret créé', secret_changed: 'Code secret changé',
};
const preciseTime = (iso: string) => new Date(iso).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Lubumbashi' });

/** Who unlocked the cash, when (to the second) and why — and the wrong codes tried. */
function UnlockHistory({ base, stationId, canWrite, secretSet, onSecret }: any) {
  const q = useQuery({
    queryKey: ['cash-unlock-events', stationId],
    queryFn: async () => (await api.get(`${base}/unlock-events`)).data as any[],
  });
  const events = q.data || [];
  if (!events.length && !(canWrite && secretSet)) return null;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border bg-secondary px-4 py-2 text-xs font-medium text-muted-foreground">
        <span>Historique des déverrouillages</span>
        {canWrite && secretSet && <button className="text-primary" onClick={onSecret}>Changer mon code</button>}
      </div>
      {!events.length ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Aucun déverrouillage.</p>
      ) : (
        <ul className="divide-y divide-border">
          {events.map((e: any) => (
            <li key={e.id} className="px-4 py-3 text-sm">
              <p className={cn('font-semibold', e.action === 'unlock' ? 'text-amber-600' : e.action === 'secret_set' || e.action === 'secret_changed' ? 'text-foreground' : 'text-rose-500')}>
                {UNLOCK_ACTIONS[e.action] || e.action}{e.business_day ? ` · journée du ${dayLabel(e.business_day, false)}${e.currency ? ` (${e.currency})` : ''}` : ''}
              </p>
              <p className="text-xs capitalize text-muted-foreground">{preciseTime(e.created_at)}{e.user_name ? ` · ${e.user_name}` : ''}</p>
              {e.reason && <p className="mt-0.5 text-xs text-foreground">Motif : {e.reason}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CloseSheet({ data, currency, base, pdfMeta, onDone, onCancel }: any) {
  const [counted, setCounted] = useState('');
  const [openingText, setOpeningText] = useState('');
  const [note, setNote] = useState('');
  const cents = counted.trim() ? toCents(counted) : NaN;
  const gap = Number.isFinite(cents) ? cents - data.expected_cents : null;
  const firstClosing = data.opening_cents === 0;
  const m = useMutation({
    mutationFn: async () => (await api.post(`${base}/closings`, {
      date: data.day, currency, counted_cents: cents, note: note.trim() || undefined,
      ...(firstClosing && openingText.trim() ? { opening_cents: Math.max(0, toCents(openingText) || 0) } : {}),
    })).data,
    onSuccess: (row: any) => {
      deliverPdf(buildClosingPdf(row, { ...pdfMeta, cashiers: data.cashiers }), `cloture-${row.business_day}.pdf`).catch(() => undefined);
      onDone();
    },
  });
  return (
    <FormSheet onClose={onCancel} title="Clôturer la caisse">
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold">Clôturer la caisse</h2>
          <p className="text-sm capitalize text-muted-foreground">{dayLabel(data.day)} · {currency}</p>
        </div>
        <div className="rounded-2xl bg-secondary p-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Espèces attendues</span><span className="font-bold">{money(data.expected_cents, currency)}</span></div>
          <p className="mt-1 text-xs text-muted-foreground">Ouverture {money(data.opening_cents, currency)} + encaissé {money(data.receipts_cents, currency)} − sorti {money(data.payments_cents, currency)}</p>
        </div>
        {data.pending_expenses_list?.length > 0 && (
          <p className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
            {data.pending_expenses_list.length} dépense(s) en attente de validation ne sont pas déduites de cette clôture : elles le seront à leur validation.
          </p>
        )}
        {firstClosing && (
          <div className="space-y-1.5">
            <Label htmlFor="cl_open">Argent déjà en caisse ce matin (première clôture, facultatif)</Label>
            <Input id="cl_open" inputMode="decimal" value={openingText} onChange={(e) => setOpeningText(e.target.value)} placeholder="0" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="cl_counted">Espèces comptées dans la caisse</Label>
          <Input id="cl_counted" inputMode="decimal" autoFocus value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="Montant compté" />
          {gap !== null && (
            <p className={cn('text-sm font-semibold', gap === 0 ? 'text-emerald-600' : 'text-rose-500')}>
              {gap === 0 ? 'Caisse juste' : `Écart ${gap > 0 ? '+' : ''}${money(gap, currency)} (${gap > 0 ? 'excédent' : 'manquant'})`}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cl_note">Note (facultatif)</Label>
          <Input id="cl_note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </div>
        {m.isError && <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{errorText(m.error, 'Clôture impossible — réessayez.')}</p>}
        <Button className="w-full" disabled={!Number.isFinite(cents) || cents < 0 || m.isPending} onClick={() => m.mutate()}>
          {m.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Clôturer et verrouiller la journée
        </Button>
        <p className="text-xs text-muted-foreground">Votre code d'accès sera demandé. Après clôture, seuls le gérant ou le patron peuvent rouvrir la journée.</p>
      </div>
    </FormSheet>
  );
}

function ReopenSheet({ closing, base, onDone, onCancel }: any) {
  const [reason, setReason] = useState('');
  const m = useMutation({ mutationFn: async () => (await api.post(`${base}/closings/${closing.id}/reopen`, { reason: reason.trim() })).data, onSuccess: onDone });
  return (
    <FormSheet onClose={onCancel} title="Rouvrir la journée">
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold">Rouvrir la journée</h2>
          <p className="text-sm capitalize text-muted-foreground">{dayLabel(closing.business_day)}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ro_reason">Motif de la réouverture</Label>
          <Input id="ro_reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Ex. erreur de comptage" />
          <p className="text-xs text-muted-foreground">Le motif est conservé et le caissier est prévenu. Il devra clôturer de nouveau.</p>
        </div>
        {m.isError && <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{errorText(m.error, 'Réouverture impossible.')}</p>}
        <Button className="w-full" disabled={reason.trim().length < 5 || m.isPending} onClick={() => m.mutate()}>
          {m.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Rouvrir la journée
        </Button>
      </div>
    </FormSheet>
  );
}

// ---------------------------------------------------------------------------------------------- monthly cash book

function BookTab({ q, currency, onMonth, pdfMeta }: any) {
  const b = q.data;
  if (q.isLoading || !b) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (q.isError) return <p className="py-8 text-center text-sm text-destructive">{errorText(q.error, 'Impossible de charger le livre de caisse.')}</p>;

  const exportCsv = () => {
    const rows: (string | number)[][] = [['Livre de caisse', b.merchant.name, monthLabel(b.month), currency], [], ['Date', 'Heure', 'Type', 'Libellé', 'Par', 'Encaissement', 'Décaissement', 'Solde']];
    for (const d of b.days) {
      rows.push([d.day, '', 'Ouverture', '', '', '', '', csvAmount(d.opening_cents)]);
      for (const e of d.entries) rows.push([d.day, hour(e.at), KIND_LABELS[e.kind], e.label || '', e.by || '', e.direction === 'in' ? csvAmount(e.amount_cents) : '', e.direction === 'out' ? csvAmount(e.amount_cents) : '', csvAmount(e.balance_cents ?? 0)]);
      rows.push([d.day, '', d.closed ? 'Clôture (compté)' : 'Fin de journée (non clôturée)', '', '', csvAmount(d.receipts_cents), csvAmount(d.payments_cents), csvAmount(d.closing_cents)]);
    }
    rows.push([], ['', '', 'Solde de clôture du mois', '', '', csvAmount(b.receipts_cents), csvAmount(b.payments_cents), csvAmount(b.closing_cents)]);
    downloadCsv(`livre-de-caisse-${b.month}-${currency}.csv`, rows);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button className="rounded-full p-2 hover:bg-accent" aria-label="Mois précédent" onClick={() => onMonth(addMonths(b.month, -1))}><ChevronLeft className="h-5 w-5" /></button>
        <p className="text-sm font-semibold capitalize">{monthLabel(b.month)}</p>
        <button className="rounded-full p-2 hover:bg-accent" aria-label="Mois suivant" onClick={() => onMonth(addMonths(b.month, 1))}><ChevronRight className="h-5 w-5" /></button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Solde d'ouverture" value={money(b.opening_cents, currency)} />
        <Stat label="Encaissements" value={money(b.receipts_cents, currency)} tone="in" />
        <Stat label="Décaissements" value={money(b.payments_cents, currency)} tone="out" />
        <Stat label="Solde de clôture" value={money(b.closing_cents, currency)} />
      </div>
      {b.discrepancy_cents !== 0 && <p className="text-xs text-rose-500">Écarts de caisse constatés ce mois-ci : {money(b.discrepancy_cents, currency)}</p>}
      {b.unclosed_days.length > 0 && (
        <p className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /> Jours non clôturés : {b.unclosed_days.map((x: string) => dayLabel(x, false)).join(', ')}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => deliverPdf(buildCashBookPdf(b, { ...pdfMeta, cashiers: b.cashiers }), `livre-de-caisse-${b.month}-${currency}.pdf`)}><Download className="mr-1.5 h-4 w-4" /> PDF</Button>
        <Button variant="outline" size="sm" onClick={exportCsv}><FileSpreadsheet className="mr-1.5 h-4 w-4" /> Excel (CSV)</Button>
      </div>

      {!b.days.length ? (
        <EmptyState icon={BookOpen} title="Aucun mouvement ce mois-ci" text="Les ventes en espèces, entrées, dépenses et sorties de caisse apparaîtront ici dans l'ordre." />
      ) : (
        b.days.map((d: any) => (
          <Card key={d.day} className="overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-secondary px-4 py-2">
              <p className="text-sm font-semibold capitalize">{dayLabel(d.day, false)}</p>
              <p className="text-xs text-muted-foreground">Ouverture {money(d.opening_cents, currency)}</p>
            </div>
            <div className="divide-y divide-border">
              {d.entries.map((e: any) => (
                <div key={e.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="text-xs text-muted-foreground">{hour(e.at)}</span>
                  <span className="min-w-0 truncate">{KIND_LABELS[e.kind]}{e.label && e.kind !== 'adjustment' ? ` · ${e.label}` : ''}</span>
                  <span className="text-right">
                    <span className={cn('font-semibold', e.direction === 'in' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500')}>{e.direction === 'in' ? '+' : '−'}{money(e.amount_cents, currency)}</span>
                    <span className="block text-[11px] text-muted-foreground">{money(e.balance_cents ?? 0, currency)}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-border bg-secondary/50 px-4 py-2 text-xs">
              <span className="flex items-center gap-1 text-muted-foreground">{d.closed ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Clôturée</> : 'Non clôturée'}</span>
              <span className="font-semibold text-foreground">Solde {money(d.closing_cents, currency)}</span>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- reports

function ReportsTab({ q, currency, period, onPeriod, onAnchor, todayKey, pdfMeta, stationName }: any) {
  const r = q.data;
  const periods: { value: Period; label: string }[] = [{ value: 'day', label: 'Jour' }, { value: 'week', label: 'Semaine' }, { value: 'month', label: 'Mois' }, { value: 'year', label: 'Année' }];

  const label = (x: any) => {
    if (x.period === 'day') return dayLabel(x.first_day);
    if (x.period === 'week') return `Semaine du ${dayLabel(x.first_day, false)} au ${dayLabel(x.last_day, false)}`;
    if (x.period === 'month') return monthLabel(x.first_day.slice(0, 7));
    return `Année ${x.first_day.slice(0, 4)}`;
  };
  const shift = (dir: -1 | 1) => {
    if (!r) return;
    if (dir === -1) onAnchor(addDays(r.first_day, -1));
    else onAnchor(addDays(r.last_day, 1));
  };
  const atEnd = !!(r && todayKey && r.last_day >= todayKey);

  const exportCsv = () => {
    if (!r) return;
    const rows: (string | number)[][] = [['Rapport de caisse', stationName || '', label(r), currency], [], [r.period === 'year' ? 'Mois' : 'Jour', 'Ventes espèces', 'Entrées', 'Hors caisse', 'Dépenses', 'Sorties']];
    for (const s of r.series) rows.push([s.key, csvAmount(s.cash_sales_cents), csvAmount(s.cash_in_cents), csvAmount(s.non_cash_cents), csvAmount(s.expenses_cents), csvAmount(s.cash_out_cents)]);
    rows.push([], ['Total', csvAmount(r.cash_sales_cents), csvAmount(r.cash_in_cents), csvAmount(r.non_cash_cents), csvAmount(r.expenses_cents), csvAmount(r.cash_out_cents)]);
    downloadCsv(`rapport-caisse-${r.period}-${r.first_day}-${currency}.csv`, rows);
  };
  const max = r ? Math.max(1, ...r.series.map((s: any) => Math.max(s.cash_sales_cents + s.non_cash_cents, s.expenses_cents + s.cash_out_cents))) : 1;

  return (
    <div className="space-y-4">
      <FilterChips label="Période" value={period} onChange={onPeriod} options={periods} />
      {q.isLoading || !r ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : q.isError ? (
        <p className="py-8 text-center text-sm text-destructive">{errorText(q.error, 'Impossible de charger le rapport.')}</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <button className="rounded-full p-2 hover:bg-accent" aria-label="Période précédente" onClick={() => shift(-1)}><ChevronLeft className="h-5 w-5" /></button>
            <p className="text-center text-sm font-semibold capitalize">{label(r)}</p>
            <button className="rounded-full p-2 hover:bg-accent disabled:opacity-30" aria-label="Période suivante" disabled={atEnd} onClick={() => shift(1)}><ChevronRight className="h-5 w-5" /></button>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Chiffre d'affaires" value={money(r.turnover_cents, currency)} />
            <Stat label="Ventes en espèces" value={money(r.cash_sales_cents, currency)} tone="in" />
            <Stat label="Dépenses + sorties" value={money(r.payments_cents, currency)} tone="out" />
            <Stat label="Variation de la caisse" value={money(r.net_cents, currency)} />
            <Stat label="Hors caisse" value={money(r.non_cash_cents, currency)} />
            <Stat label="Nombre de ventes" value={String(r.sales_count)} />
            <Stat label="Panier moyen" value={money(r.average_ticket_cents, currency)} />
            <Stat label="Écarts de clôture" value={money(r.discrepancy_cents, currency)} tone={r.discrepancy_cents ? 'out' : undefined} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => deliverPdf(buildCashReportPdf(r, { ...pdfMeta, cashiers: r.cashiers, periodLabel: label(r) }), `rapport-caisse-${r.period}-${r.first_day}-${currency}.pdf`)}><Download className="mr-1.5 h-4 w-4" /> PDF</Button>
            <Button variant="outline" size="sm" onClick={exportCsv}><FileSpreadsheet className="mr-1.5 h-4 w-4" /> Excel (CSV)</Button>
          </div>

          {r.unclosed_days.length > 0 && (
            <p className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /> Jours non clôturés : {r.unclosed_days.map((x: string) => dayLabel(x, false)).join(', ')}</p>
          )}

          <Card className="p-4">
            <p className="mb-3 text-sm font-semibold">{r.period === 'year' ? 'Entrées et sorties par mois' : 'Entrées et sorties par jour'}</p>
            <div className="flex h-36 items-end gap-1">
              {r.series.map((s: any) => (
                <div key={s.key} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${s.key} · entrées ${money(s.cash_sales_cents + s.non_cash_cents, currency)} · sorties ${money(s.expenses_cents + s.cash_out_cents, currency)}`}>
                  <div className="flex h-full w-full items-end gap-[2px]">
                    <div className="w-full rounded-t bg-primary/70" style={{ height: `${Math.max(2, Math.round(((s.cash_sales_cents + s.non_cash_cents) / max) * 100))}%` }} />
                    <div className="w-full rounded-t bg-rose-500/70" style={{ height: `${Math.max(2, Math.round(((s.expenses_cents + s.cash_out_cents) / max) * 100))}%` }} />
                  </div>
                  <span className="text-[9px] text-muted-foreground">{r.period === 'year' ? s.key.slice(5) : s.key.slice(8)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary/70" /> Ventes</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500/70" /> Dépenses et sorties</span>
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <BreakdownCard title="Par mode de paiement" rows={r.by_method.map((m: any) => ({ label: m.method, cents: m.amount_cents }))} currency={currency} />
            <BreakdownCard title="Dépenses par catégorie" rows={r.by_category.map((m: any) => ({ label: m.category, cents: m.amount_cents }))} currency={currency} />
            <BreakdownCard title="Par vendeur / caissier" rows={r.by_seller.map((s: any) => ({ label: s.by || '—', cents: s.cash_cents + s.non_cash_cents }))} currency={currency} />
            <Card className="p-4">
              <p className="mb-2 text-sm font-semibold">Clôtures de caisse</p>
              {r.closings.filter((c: any) => c.status === 'closed').length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune clôture sur cette période.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {r.closings.filter((c: any) => c.status === 'closed').map((c: any) => (
                    <li key={c.day} className="flex items-center justify-between gap-2">
                      <span>{dayLabel(c.day, false)}</span>
                      <span className={cn('font-semibold', c.discrepancy_cents === 0 ? 'text-emerald-600' : 'text-rose-500')}>{c.discrepancy_cents === 0 ? 'Juste' : `${c.discrepancy_cents > 0 ? '+' : ''}${money(c.discrepancy_cents, currency)}`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function BreakdownCard({ title, rows, currency }: { title: string; rows: { label: string; cents: number }[]; currency: string }) {
  const total = rows.reduce((s, r) => s + r.cents, 0) || 1;
  return (
    <Card className="p-4">
      <p className="mb-2 text-sm font-semibold">{title}</p>
      {!rows.length ? <p className="text-sm text-muted-foreground">Rien sur cette période.</p> : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.label} className="text-sm">
              <div className="flex justify-between gap-2"><span className="truncate">{r.label}</span><span className="font-semibold">{money(r.cents, currency)}</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((r.cents / total) * 100)}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------- expenses

function ExpensesTab({ q, canWrite, isManager, base, onChanged, onNew }: any) {
  const [rejecting, setRejecting] = useState<any | null>(null);
  const approve = useMutation({ mutationFn: async (id: string) => (await api.post(`${base}/expenses/${id}/approve`)).data, onSuccess: onChanged });

  if (q.isLoading || !q.data) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  const pending = q.data.filter((e: any) => e.status === 'pending');
  const others = q.data.filter((e: any) => e.status !== 'pending');
  const row = (e: any) => (
    <li key={e.id} className="space-y-2 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">{e.category || 'Dépense'} · {e.description}</p>
          <p className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{e.by ? ` · ${e.by}` : ''}</p>
          {e.reject_reason && <p className="text-xs text-rose-500">Rejet : {e.reject_reason}</p>}
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-sm font-bold">{money(e.amount_cents, e.currency)}</p>
          <p className={cn('text-[11px] font-medium', e.status === 'approved' ? 'text-emerald-600' : e.status === 'rejected' ? 'text-rose-500' : 'text-amber-600')}>{STATUS_LABELS[e.status]}</p>
        </div>
      </div>
      {isManager && e.status === 'pending' && (
        <div className="flex gap-2">
          <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(e.id)}>Valider</Button>
          <Button size="sm" variant="outline" onClick={() => setRejecting(e)}>Rejeter</Button>
        </div>
      )}
    </li>
  );

  return (
    <div className="space-y-4">
      {canWrite && <Button onClick={onNew}><Receipt className="mr-2 h-4 w-4" /> Nouvelle dépense</Button>}
      {approve.isError && <p className="text-sm text-destructive">{errorText(approve.error, 'Validation impossible.')}</p>}
      <Card className="overflow-hidden">
        <div className="border-b border-border bg-secondary px-4 py-2 text-xs font-medium text-muted-foreground">À valider ({pending.length})</div>
        {pending.length ? <ul className="divide-y divide-border">{pending.map(row)}</ul> : <p className="py-6 text-center text-sm text-muted-foreground">Aucune dépense en attente.</p>}
      </Card>
      <Card className="overflow-hidden">
        <div className="border-b border-border bg-secondary px-4 py-2 text-xs font-medium text-muted-foreground">Dernières dépenses</div>
        {others.length ? <ul className="divide-y divide-border">{others.map(row)}</ul> : <p className="py-6 text-center text-sm text-muted-foreground">Aucune dépense enregistrée.</p>}
      </Card>
      {rejecting && <RejectSheet expense={rejecting} base={base} onDone={() => { setRejecting(null); onChanged(); }} onCancel={() => setRejecting(null)} />}
    </div>
  );
}

function RejectSheet({ expense, base, onDone, onCancel }: any) {
  const [reason, setReason] = useState('');
  const m = useMutation({ mutationFn: async () => (await api.post(`${base}/expenses/${expense.id}/reject`, { reason: reason.trim() })).data, onSuccess: onDone });
  return (
    <FormSheet onClose={onCancel} title="Rejeter la dépense">
      <div className="space-y-4">
        <h2 className="text-lg font-bold">Rejeter la dépense</h2>
        <p className="text-sm text-muted-foreground">{expense.category} · {expense.description} · {money(expense.amount_cents, expense.currency)}</p>
        <div className="space-y-1.5">
          <Label htmlFor="rj_reason">Motif du rejet</Label>
          <Input id="rj_reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </div>
        {m.isError && <p className="text-sm text-destructive">{errorText(m.error, 'Rejet impossible.')}</p>}
        <Button className="w-full" disabled={reason.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
          {m.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Rejeter
        </Button>
      </div>
    </FormSheet>
  );
}

function ExpenseSheet({ currency, base, isManager, onDone, onCancel }: any) {
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const cents = amount.trim() ? toCents(amount) : NaN;
  const m = useMutation({
    mutationFn: async () => (await api.post(`${base}/expenses`, { amount_cents: cents, currency, category, description: description.trim() })).data,
    onSuccess: onDone,
  });
  return (
    <FormSheet onClose={onCancel} title="Nouvelle dépense">
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold">Nouvelle dépense</h2>
          <p className="text-sm text-muted-foreground">Sortie d'espèces de la caisse · {currency}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ex_amount">Montant</Label>
          <Input id="ex_amount" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ex_cat">Catégorie</Label>
          <Select id="ex_cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ex_desc">Motif</Label>
          <Input id="ex_desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="Ex. course moto pour livraison" />
        </div>
        {m.isError && <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{errorText(m.error, 'Enregistrement impossible — réessayez.')}</p>}
        <Button className="w-full" disabled={!Number.isFinite(cents) || cents <= 0 || description.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
          {m.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Enregistrer
        </Button>
        {!isManager && <p className="text-xs text-muted-foreground">La dépense sera déduite de la caisse après validation du gérant ou du patron ; vous serez notifié.</p>}
      </div>
    </FormSheet>
  );
}
