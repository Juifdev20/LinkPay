import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { PageHeader } from '@/components/PageHeader';
import { CurrencySelector } from '@/components/CurrencySelector';
import { DualCurrencyStat } from '@/components/DualCurrencyStat';
import { formatCurrency, formatDate } from '@/lib/utils';
import { downloadExpenseDayPdf } from '@/lib/expense-pdf';
import { ExpenseProUpgrade } from './ExpenseProUpgrade';
import { ExpensePlanSelection } from './ExpensePlanSelection';
import { Loader2, ArrowLeft, Plus, Lock, Download, Receipt, AlertTriangle } from 'lucide-react';

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
  const navigate = useNavigate();
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

  const addEntryMutation = useMutation({
    mutationFn: async () => {
      const report = current!.report!;
      const amountCents = Math.round(parseFloat(amount) * 100);
      return (await api.post(`/expense-tracker/reports/${report.id}/entries`, { amount_cents: amountCents, currency, description: description || undefined })).data;
    },
    onSuccess: () => {
      setAmount('');
      setDescription('');
      setAddError('');
      queryClient.invalidateQueries({ queryKey: ['expense-report-current'] });
    },
    onError: (err: any) => setAddError(err.response?.data?.message || "Échec de l'ajout"),
  });

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
    <div className="p-6 pb-28 md:pb-6 space-y-6 max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Retour
      </button>

      <PageHeader title="Mes dépenses" />

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
                  : `Il vous reste ${Math.max(0, (status.trial_report_limit || 0) - (status.trial_reports_used || 0))} dépense(s) sur ${status.trial_report_limit} (essai gratuit)`}
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

              {current.report.entries.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Dépenses de ce rapport</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
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

              <Button variant="outline" className="w-full" onClick={() => setShowCloseConfirm(true)} disabled={current.report.entries.length === 0}>
                <Lock className="mr-2 w-4 h-4" />
                Clôturer cette dépense
              </Button>
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
              <Button className="w-full" size="lg" onClick={() => createReportMutation.mutate()} disabled={createReportMutation.isPending}>
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
  );
}
