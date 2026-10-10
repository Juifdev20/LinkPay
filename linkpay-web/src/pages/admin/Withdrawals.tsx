import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Loader2, Send, XCircle } from 'lucide-react';
import api from '@/lib/api';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { operatorById, displayPhone, toNationalDigits } from '@/lib/mobile-money';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/PageHeader';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Row {
  id: string;
  status: 'PENDING' | 'SUCCESS' | 'REVERSED';
  amount_cents: number;
  fee_cents: number;
  currency: 'CDF' | 'USD';
  channel: 'mobile_money' | 'bank';
  destination: Record<string, any>;
  failure_reason: string | null;
  psp_reference: string | null;
  created_at: string;
  updated_at: string;
  owner: { name: string | null; email: string | null; phone: string | null; wallet_number: string | null } | null;
}

const msg = (e: any) => e?.response?.data?.message || 'Une erreur est survenue.';

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => undefined); }}
      className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted-foreground hover:border-primary/40 hover:text-primary"
      aria-label={`Copier ${label}`}
    >
      {done ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />} {done ? 'Copié' : 'Copier'}
    </button>
  );
}

/**
 * Withdrawals that wait for a person, because the payment provider has no API to send money out (FlexPaie): the amount
 * has already left the wallet; the admin sends it by hand to the Mobile Money number shown, then confirms here.
 */
export default function WithdrawalsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const [sendFor, setSendFor] = useState<Row | null>(null);
  const [rejectFor, setRejectFor] = useState<Row | null>(null);
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery<{ data: Row[] }>({
    queryKey: ['admin-withdrawals', tab],
    queryFn: async () => (await api.get(`/admin/withdrawals?status=${tab}`)).data,
    refetchInterval: tab === 'open' ? 30000 : false,
  });
  const rows = data?.data ?? [];

  const done = () => {
    setSendFor(null); setRejectFor(null); setReference(''); setReason(''); setError('');
    queryClient.invalidateQueries({ queryKey: ['admin-withdrawals'] });
  };
  const sent = useMutation({
    mutationFn: async () => api.post(`/admin/withdrawals/${sendFor!.id}/sent`, { reference: reference.trim() || undefined }),
    onSuccess: done,
    onError: (e) => setError(msg(e)),
  });
  const rejected = useMutation({
    mutationFn: async () => api.post(`/admin/withdrawals/${rejectFor!.id}/reject`, { reason: reason.trim() }),
    onSuccess: done,
    onError: (e) => setError(msg(e)),
  });

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <PageHeader title="Retraits à traiter" />
      <p className="mb-4 text-sm text-muted-foreground">
        L'argent a déjà été retiré du portefeuille du client. Envoyez-le au numéro indiqué, puis confirmez ici. En cas de refus, le montant et les frais lui sont rendus.
      </p>

      <div role="tablist" className="mb-5 grid grid-cols-2 gap-1 rounded-2xl bg-secondary p-1">
        {([['open', 'À envoyer'], ['done', 'Déjà traités']] as const).map(([v, label]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={cn('rounded-xl px-3 py-2 text-sm font-semibold transition-all', tab === v ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground')}>
            {label}{tab === v && !isLoading ? ` (${rows.length})` : ''}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="py-16"><Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" /></div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">{tab === 'open' ? 'Aucun retrait à envoyer pour le moment.' : 'Aucun retrait traité.'}</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {rows.map((w) => {
            const op = operatorById(String(w.destination?.operator ?? ''));
            const national = toNationalDigits(String(w.destination?.phone ?? ''));
            return (
              <Card key={w.id}>
                <CardContent className="space-y-4 pt-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-foreground">{w.owner?.name || w.owner?.email || 'Client'}</p>
                      <p className="text-xs text-muted-foreground">{w.owner?.wallet_number} · demandé le {formatDate(w.created_at)}</p>
                    </div>
                    {w.status !== 'PENDING' && (
                      <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-bold', w.status === 'SUCCESS' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive')}>
                        {w.status === 'SUCCESS' ? 'Envoyé' : 'Refusé'}
                      </span>
                    )}
                  </div>

                  <div className="flex items-end justify-between gap-3 rounded-2xl bg-secondary/60 px-4 py-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Montant à envoyer</p>
                      <p className="text-2xl font-bold tabular-nums text-foreground">{formatCurrency(w.amount_cents, w.currency)}</p>
                      {w.fee_cents > 0 && <p className="text-xs text-muted-foreground">Frais retenus : {formatCurrency(w.fee_cents, w.currency)}</p>}
                    </div>
                    {w.status === 'PENDING' && <CopyButton text={String(w.amount_cents / 100)} label="le montant" />}
                  </div>

                  {w.channel === 'mobile_money' ? (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {op && <img src={op.logo} alt="" className="h-10 w-10 rounded-xl object-cover" />}
                        <div>
                          <p className="text-sm font-semibold text-foreground">{op?.label ?? String(w.destination?.operator ?? 'Mobile Money')}</p>
                          <p className="text-sm tabular-nums text-muted-foreground">{national ? displayPhone(national) : String(w.destination?.phone ?? '')}</p>
                        </div>
                      </div>
                      {w.status === 'PENDING' && <CopyButton text={national ? `+243${national}` : String(w.destination?.phone ?? '')} label="le numéro" />}
                    </div>
                  ) : (
                    <div className="text-sm text-foreground">
                      <p className="font-semibold">{String(w.destination?.bank ?? 'Banque')}</p>
                      <p className="text-muted-foreground">{String(w.destination?.account_name ?? '')} — {String(w.destination?.account_number ?? '')}</p>
                    </div>
                  )}

                  {w.status === 'PENDING' ? (
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" className="text-destructive" onClick={() => { setError(''); setRejectFor(w); }}>
                        <XCircle className="mr-2 h-4 w-4" /> Refuser
                      </Button>
                      <Button onClick={() => { setError(''); setSendFor(w); }}>
                        <Send className="mr-2 h-4 w-4" /> J'ai envoyé
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {w.status === 'SUCCESS' ? `Envoyé${w.psp_reference ? ` — réf. ${w.psp_reference}` : ''}` : `Refusé : ${w.failure_reason ?? ''}`} · {formatDate(w.updated_at)}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!sendFor} onOpenChange={(o) => { if (!o) { setSendFor(null); setError(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmer l'envoi</DialogTitle>
            <DialogDescription>
              Vous confirmez avoir envoyé {sendFor && formatCurrency(sendFor.amount_cents, sendFor.currency)} à {sendFor && displayPhone(toNationalDigits(String(sendFor.destination?.phone ?? '')))}. Le client sera averti.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Référence du transfert (facultatif)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} placeholder="Numéro de transaction" />
          </div>
          {error && <p className="text-sm font-medium text-destructive" role="alert">{error}</p>}
          <Button className="mt-2 w-full" disabled={sent.isPending} onClick={() => { setError(''); sent.mutate(); }}>
            {sent.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Oui, c'est envoyé
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rejectFor} onOpenChange={(o) => { if (!o) { setRejectFor(null); setError(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refuser ce retrait</DialogTitle>
            <DialogDescription>Le montant et les frais sont rendus au portefeuille du client, qui voit la raison ci-dessous.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Raison du refus</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Ex. numéro Mobile Money incorrect" />
          </div>
          {error && <p className="text-sm font-medium text-destructive" role="alert">{error}</p>}
          <Button className="mt-2 w-full" variant="destructive" disabled={rejected.isPending || reason.trim().length < 3} onClick={() => { setError(''); rejected.mutate(); }}>
            {rejected.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Refuser et rembourser
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
