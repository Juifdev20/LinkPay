import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { PageHeader } from '@/components/PageHeader';
import { SpendingOverview } from '@/components/SpendingOverview';
import { CurrencySelector } from '@/components/CurrencySelector';
import { DualCurrencyStat } from '@/components/DualCurrencyStat';
import { formatCurrency, formatDate, countLabel } from '@/lib/utils';
import { downloadExpenseDayPdf } from '@/lib/expense-pdf';
import { ExpenseProUpgrade } from './ExpenseProUpgrade';
import { ExpensePlanSelection } from './ExpensePlanSelection';
import { Loader2, Plus, Lock, Download, Receipt, AlertTriangle, CloudUpload } from 'lucide-react';
import { enqueue, newClientRef, useOutbox } from '@/lib/outbox';
import { isNetworkError, useNetwork, useOnline } from '@/lib/network';
import type { ExpenseEntryPayload } from '@/lib/outbox-handlers';

interface ExpenseEntry {
  id: string;
  amount_cents: number;
  currency: 'CDF' | 'USD';
  description?: string;
  created_at: string;
}

interface ExpenseReport {
  id: string;
  expense_date: string;
  status: 'open' | 'closed';
  closed_at?: string;
  entries: ExpenseEntry[];
  totals: { CDF: number; USD: number };
}

interface ExpenseStatus {
  needs_plan_selection: boolean;
  plan?: 'trial' | 'unlimited';
  trial_report_limit?: number;
  trial_reports_used?: number;
  pro_expires_at: string | null;
  read_only?: boolean;
  monthly_price_cents: number;
  monthly_price_currency: 'CDF' | 'USD';
}

export default function ExpenseTrackerPage() {
  const queryClient = useQueryClient();

  const [currency, setCurrency] = useState<'CDF' | 'USD'>('CDF');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [addError, setAddError] = useState('');
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [createError, setCreateError] = useState('');
  const [closeError, setCloseError] = useState('');

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['expense-tracker-status'],
    queryFn: async () => (await api.get('/expense-tracker/status')).data as ExpenseStatus,
  });

  const { data: current, isLoading: currentLoading } = useQuery({
    queryKey: ['expense-report-current'],
    queryFn: async () => (await api.get('/expense-tracker/reports/current')).data as { report: ExpenseReport | null },
    enabled: !!status && !status.needs_plan_selection,
  });

  const { data: pastReports } = useQuery({
    queryKey: ['expense-reports'],
    queryFn: async () => (await api.get('/expense-tracker/reports')).data as ExpenseReport[],
    enabled: !!status && !status.needs_plan_selection,
  });

  const createReportMutation = useMutation({
    mutationFn: async () => (await api.post('/expense-tracker/reports')).data as ExpenseReport,
    onSuccess: () => {
      setCreateError('');
      queryClient.invalidateQueries({ queryKey: ['expense-report-current'] });
      queryClient.invalidateQueries({ queryKey: ['expense-tracker-status'] });
    },
    onError: (err: any) => {
      setCreateError(err.response?.data?.message || 'Impossible de créer une nouvelle dépense pour le moment.');
      // The trial/Pro state may have changed since this screen last loaded
      // (e.g. exhausted in another tab/device) — refetch so the paywall
      // shows instead of leaving a broken, still-clickable button.
      queryClient.invalidateQueries({ queryKey: ['expense-tracker-status'] });
    },
  });

  // Offline (or the network drops while sending): the note waits on the phone with its own id and goes out by
  // itself later (lib/outbox.ts); the server keeps it once whatever happens.
  const addEntryMutation = useMutation({
    // React Query would hold the mutation until the network is back; here offline is handled by the outbox.
    networkMode: 'always',
    mutationFn: async () => {
      const report = current!.report!;
      const payload: ExpenseEntryPayload = {
        report_id: report.id,
        amount_cents: Math.round(parseFloat(amount) * 100),
        currency,
        description: description || undefined,
        noted_at: new Date().toISOString(),
      };
      const clientRef = newClientRef();
      const queue = () => { enqueue('expense.entry', `Dépense : ${payload.description || 'sans description'}`, payload, formatCurrency(payload.amount_cents, payload.currency), clientRef); return 'queued' as const; };
      if (!useNetwork.getState().online) return queue();
      try {
        await api.post(`/expense-tracker/reports/${report.id}/entries`, { ...payload, client_ref: clientRef, report_id: undefined });
        return 'sent' as const;
      } catch (err) {
        if (isNetworkError(err)) return queue();
        throw err;
      }
    },
    onSuccess: (how) => {
      setAmount('');
      setDescription('');
      setAddError('');
      if (how === 'sent') queryClient.invalidateQueries({ queryKey: ['expense-report-current'] });
    },
    onError: (err: any) => setAddError(err.response?.data?.message || "Échec de l'ajout"),
  });
  const online = useOnline();
  const waitingOps = useOutbox((s) => s.ops);
  const waitingEntries = current?.report
    ? waitingOps.filter((o) => o.kind === 'expense.entry' && (o.payload as ExpenseEntryPayload).report_id === current.report!.id)
    : [];

  const closeReportMutation = useMutation({
    mutationFn: async () => (await api.post(`/expense-tracker/reports/${current!.report!.id}/close`)).data,
    onSuccess: () => {
      setShowCloseConfirm(false);
      setCloseError('');
      queryClient.invalidateQueries({ queryKey: ['expense-report-current'] });
      queryClient.invalidateQueries({ queryKey: ['expense-reports'] });
      queryClient.invalidateQueries({ queryKey: ['expense-tracker-status'] });
    },
    onError: (err: any) => setCloseError(err.response?.data?.message || 'Échec de la clôture'),
  });

  const handleDownload = async (reportId: string) => {
    setDownloadingId(reportId);
    try {
      const { data } = await api.get(`/expense-tracker/reports/${reportId}/pdf-data`);
      await downloadExpenseDayPdf(data);
    } finally {
      setDownloadingId(null);
    }
  };

  if (statusLoading || !status) {
    return (
      <div className="p-6 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="px-4 pt-2 pb-28 md:p-6 space-y-5 max-w-2xl lg:max-w-6xl mx-auto">
      <PageHeader title="Mes dépenses" />

      {/* Computer: the automatic breakdown on the left (stays in view), the notebook on the right. */}
      <div className="space-y-5 lg:grid lg:grid-cols-5 lg:items-start lg:gap-6 lg:space-y-0">
      <div className="lg:sticky lg:top-24 lg:col-span-2">
      {/* Automatic: what left the wallet, by category (as in the design). */}
      <SpendingOverview />
      </div>

      <div className="space-y-5 lg:col-span-3">
      {/* The personal notebook (expenses written by hand, Pro plan), below. */}
      <div className="pt-2 lg:pt-0">
        <p className="text-[15px] font-bold text-foreground">Mon carnet de dépenses</p>
        <p className="text-xs text-muted-foreground">Notez vos dépenses du quotidien, même celles payées en espèces.</p>
      </div>

      {status.needs_plan_selection ? (
        <ExpensePlanSelection status={status} />
      ) : currentLoading ? (
        <div className="p-6 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {status.plan === 'trial' && (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
              <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0" />
              <p className="text-sm font-semibold text-destructive">
                {status.read_only
                  ? "Limite d'essai atteinte — passez en illimité pour continuer"
                  : `Il vous reste ${countLabel(Math.max(0, (status.trial_report_limit || 0) - (status.trial_reports_used || 0)), 'dépense')} sur ${status.trial_report_limit} (essai gratuit)`}
              </p>
            </div>
          )}

          {current?.report ? (
            <>
              <Card>
                <CardContent className="pt-6 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <Receipt className="w-7 h-7 text-primary" />
                  </div>
                  <p className="text-sm text-muted-foreground mb-1">{formatDate(current.report.expense_date)}</p>
                  <DualCurrencyStat amounts={current.report.totals} className="text-center" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Ajouter une dépense</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {addError && (
                    <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">
                      {addError}
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label className="font-semibold text-sm">Devise</Label>
                    <CurrencySelector value={currency} onChange={setCurrency} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="expense_amount" className="font-semibold text-sm">Montant ({currency})</Label>
                    <Input
                      id="expense_amount"
                      type="number"
                      step="0.01"
                      placeholder={currency === 'CDF' ? '5000' : '5.00'}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="expense_description" className="font-semibold text-sm">Description (optionnel)</Label>
                    <Input id="expense_description" placeholder="Transport, repas..." value={description} onChange={(e) => setDescription(e.target.value)} />
                  </div>
                  <Button
                    className="w-full"
                    disabled={!amount || Math.round(parseFloat(amount) * 100) < 1 || addEntryMutation.isPending}
                    onClick={() => addEntryMutation.mutate()}
                  >
                    {addEntryMutation.isPending ? <Loader2 className="mr-2 w-4 h-4 animate-spin" /> : <Plus className="mr-2 w-4 h-4" />}
                    Ajouter
                  </Button>
                </CardContent>
              </Card>

              {(current.report.entries.length > 0 || waitingEntries.length > 0) && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Dépenses de ce rapport</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {waitingEntries.map((o) => {
                        const p = o.payload as ExpenseEntryPayload;
                        return (
                          <div key={o.id} className="flex items-center justify-between gap-3 py-1.5 text-sm border-b border-border last:border-0">
                            <div className="min-w-0">
                              <p className="text-foreground truncate">{p.description || '—'}</p>
                              <p className={`flex items-center gap-1 text-xs ${o.status === 'error' ? 'text-destructive' : 'text-primary'}`}>
                                <CloudUpload className="h-3 w-3" /> {o.status === 'error' ? 'Refusée — voir Synchronisation' : 'En attente d\'envoi'}
                              </p>
                            </div>
                            <span className="font-semibold text-foreground flex-shrink-0">{formatCurrency(p.amount_cents, p.currency)}</span>
                          </div>
                        );
                      })}
                      {current.report.entries.map((e) => (
                        <div key={e.id} className="flex items-center justify-between py-1.5 text-sm border-b border-border last:border-0">
                          <div className="min-w-0">
                            <p className="text-foreground truncate">{e.description || '—'}</p>
                            <p className="text-xs text-muted-foreground">{formatDate(e.created_at)}</p>
                          </div>
                          <span className="font-semibold text-foreground flex-shrink-0">{formatCurrency(e.amount_cents, e.currency)}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              <Button variant="outline" className="w-full" onClick={() => setShowCloseConfirm(true)} disabled={current.report.entries.length === 0 || !online || waitingEntries.length > 0}>
                <Lock className="mr-2 w-4 h-4" />
                Clôturer cette dépense
              </Button>
              {(!online || waitingEntries.length > 0) && (
                <p className="-mt-3 text-center text-xs text-muted-foreground">
                  {!online ? 'La clôture se fait en ligne.' : 'Clôture possible quand les dépenses en attente seront envoyées.'}
                </p>
              )}
            </>
          ) : status.read_only ? (
            <ExpenseProUpgrade status={status} />
          ) : (
            <>
              {createError && (
                <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">
                  {createError}
                </div>
              )}
              {!online && <p className="text-center text-xs text-muted-foreground">Ouvrir une nouvelle page du carnet demande Internet. Ensuite, vous pourrez y noter vos dépenses même sans réseau.</p>}
              <Button className="w-full" size="lg" onClick={() => createReportMutation.mutate()} disabled={createReportMutation.isPending || !online}>
                {createReportMutation.isPending ? <Loader2 className="mr-2 w-4 h-4 animate-spin" /> : <Plus className="mr-2 w-4 h-4" />}
                Nouvelle dépense
              </Button>
            </>
          )}

          {pastReports && pastReports.filter((r) => r.status === 'closed').length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Dépenses précédentes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {pastReports.filter((r) => r.status === 'closed').map((r) => (
                    <div key={r.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                      <p className="text-sm text-foreground">{formatDate(r.expense_date)}{r.closed_at ? ` — ${formatDate(r.closed_at)}` : ''}</p>
                      <Button variant="ghost" size="sm" onClick={() => handleDownload(r.id)} disabled={downloadingId === r.id}>
                        {downloadingId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={showCloseConfirm} onOpenChange={setShowCloseConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clôturer cette dépense ?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Une fois clôturée, vous ne pourrez plus y ajouter de ligne. Cette action est définitive
            {status.plan === 'trial' ? ' et compte dans votre limite d’essai gratuit.' : '.'}
          </p>
          {closeError && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">
              {closeError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCloseConfirm(false)}>Annuler</Button>
            <Button onClick={() => closeReportMutation.mutate()} disabled={closeReportMutation.isPending}>
              {closeReportMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
              Clôturer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
      </div>
    </div>
  );
}
