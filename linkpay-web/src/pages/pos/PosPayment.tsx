import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { FormSheet } from '@/components/FormSheet';
import { PaymentRequestShareCard } from '@/components/PaymentRequestShareCard';
import { posErrorMessage } from './PosPage';
import { formatCurrency } from '@/lib/utils';
import { Banknote, QrCode, Loader2, CheckCircle, Clock } from 'lucide-react';

/**
 * Settlement sheet — multi-paiement (spec 1.2): the remaining amount can be
 * tendered in cash and/or via a ScanLinkPay QR, in any order. Cash part:
 * the cashier types what the customer hands over ("Montant remis") — if
 * that's less than the remaining, the rest stays for another method; if
 * more, the sheet shows the change to give back. A ScanLinkPay part stays
 * "en attente" until the customer's payment is confirmed (poll).
 */
export function PosPaymentSheet({
  merchantId,
  ticket,
  onTicketUpdate,
  onPaid,
  onClose,
}: {
  merchantId: string;
  ticket: any;
  onTicketUpdate: (t: any) => void;
  onPaid: (t: any) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [received, setReceived] = useState('');
  const [qrRequest, setQrRequest] = useState<any>(null);

  const payments: any[] = ticket.payments || [];
  const spokenFor = payments.reduce((sum: number, p: any) => sum + p.amount_cents, 0);
  const remaining = Math.max(0, (ticket.total_cents || 0) - spokenFor);
  const remainingUnits = remaining / 100;

  const receivedCents = Math.round(parseFloat(received || '0') * 100);
  const cashPart = Math.min(receivedCents || remaining, remaining);
  const change = Math.max(0, receivedCents - remaining);

  // Poll the ticket while a ScanLinkPay part is pending — the backend marks
  // the payment confirmed (and the ticket paid) once the request is PAID.
  const hasPendingSlp = payments.some((p: any) => p.method === 'scanlinkpay' && p.status === 'pending');
  const { data: polled } = useQuery({
    queryKey: ['pos-ticket-poll', ticket.id],
    queryFn: async () => (await api.get(`/merchants/${merchantId}/pos/tickets/${ticket.id}`)).data,
    enabled: hasPendingSlp,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!polled) return;
    if (polled.status === 'paid') onPaid(polled);
    else onTicketUpdate(polled);
  }, [polled?.status, polled?.payments?.length]);

  const payCash = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/merchants/${merchantId}/pos/tickets/${ticket.id}/pay/cash`, {
        amount_cents: cashPart,
        received_cents: receivedCents || cashPart,
      });
      if (data.status === 'paid') onPaid(data);
      else {
        onTicketUpdate(data);
        setReceived('');
      }
    } catch (err: any) {
      setError(posErrorMessage(err, 'Paiement impossible'));
    } finally {
      setBusy(false);
    }
  };

  const payScanlinkpay = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/merchants/${merchantId}/pos/tickets/${ticket.id}/pay/scanlinkpay`, {});
      onTicketUpdate(data.ticket);
      setQrRequest(data.payment_request);
    } catch (err: any) {
      setError(posErrorMessage(err, 'Paiement impossible'));
    } finally {
      setBusy(false);
    }
  };

  // The customer ends up paying another way — drop the pending QR so its
  // amount is freed (the linked payment_request just expires unused).
  const voidPendingSlp = async () => {
    const pending = payments.find((p: any) => p.method === 'scanlinkpay' && p.status === 'pending');
    if (!pending) { setQrRequest(null); return; }
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/merchants/${merchantId}/pos/tickets/${ticket.id}/payments/${pending.id}/void`);
      onTicketUpdate(data);
      setQrRequest(null);
    } catch (err: any) {
      setError(posErrorMessage(err, 'Impossible de retirer ce paiement'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSheet onClose={onClose} title="Encaissement">
      <div className="p-6 max-w-lg mx-auto space-y-5">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            Ticket #{ticket.ticket_number ?? '—'} · {ticket.items?.filter((i: any) => i.status !== 'voided').length || 0} article(s)
          </p>
          <p className="text-3xl font-bold text-foreground">{formatCurrency(remaining, ticket.currency)}</p>
          <p className="text-xs text-muted-foreground">reste à payer sur {formatCurrency(ticket.total_cents, ticket.currency)}</p>
        </div>

        {payments.length > 0 && (
          <div className="rounded-xl bg-secondary p-3 space-y-1.5 text-sm">
            {payments.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  {p.method === 'cash' ? <Banknote className="w-3.5 h-3.5" /> : <QrCode className="w-3.5 h-3.5" />}
                  {p.method === 'cash' ? 'Espèces' : 'ScanLinkPay'}
                  {p.status === 'pending' && <Badge variant="outline" className="text-[10px] gap-1"><Clock className="w-3 h-3" /> en attente</Badge>}
                </span>
                <span className="font-medium text-foreground">{formatCurrency(p.amount_cents, ticket.currency)}</span>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        {!qrRequest ? (
          <>
            {/* Cash — "montant remis" = what the customer hands over; if it
                covers less than the remaining, the rest goes to another
                method; if more, the sheet shows the change. */}
            <div className="space-y-2">
              <Label htmlFor="received">Espèces remises ({ticket.currency})</Label>
              <Input
                id="received"
                type="number"
                inputMode="decimal"
                placeholder={remainingUnits.toString()}
                value={received}
                onChange={(e) => setReceived(e.target.value)}
                autoFocus
              />
              {/* Quick tender — "Appoint" fills the exact remaining; bill
                  buttons accumulate (a customer often hands several notes). */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setReceived(String(remainingUnits))}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent"
                >
                  Appoint
                </button>
                {(ticket.currency === 'USD' ? [1, 5, 10, 20, 50] : [500, 1000, 2000, 5000, 10000, 20000]).map((d) => (
                  <button
                    key={d}
                    onClick={() => setReceived(String((parseFloat(received || '0') || 0) + d))}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent"
                  >
                    +{d.toLocaleString('fr-CD')}
                  </button>
                ))}
              </div>
              {change > 0 && (
                <p className="text-sm font-semibold text-success">
                  Monnaie à rendre : {formatCurrency(change, ticket.currency)}
                </p>
              )}
              {receivedCents > 0 && receivedCents < remaining && (
                <p className="text-xs text-muted-foreground">
                  Partiel : {formatCurrency(remaining - receivedCents, ticket.currency)} resteront à régler par un autre moyen.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button onClick={payCash} disabled={busy || remaining <= 0}>
                {busy && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                <Banknote className="mr-2 w-4 h-4" />
                Espèces
              </Button>
              <Button variant="outline" onClick={payScanlinkpay} disabled={busy || remaining <= 0}>
                <QrCode className="mr-2 w-4 h-4" />
                ScanLinkPay
              </Button>
            </div>
          </>
        ) : (
          <div className="text-center space-y-4">
            <p className="font-semibold text-foreground">Le client paie via ScanLinkPay</p>
            <PaymentRequestShareCard request={qrRequest} />
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> En attente du paiement…
            </div>
            <Button variant="outline" className="w-full" disabled={busy} onClick={voidPendingSlp}>
              {busy && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
              Annuler ce QR — payer autrement
            </Button>
          </div>
        )}

        {ticket.status === 'paid' && (
          <div className="flex items-center justify-center gap-2 text-success">
            <CheckCircle className="w-5 h-5" /> Ticket soldé
          </div>
        )}
      </div>
    </FormSheet>
  );
}
