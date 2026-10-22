import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Banknote, Loader2, QrCode, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormSheet } from '@/components/FormSheet';
import { publicOrigin } from '@/lib/share';
import { formatCurrency } from '@/lib/utils';
import { useOnline } from '@/lib/network';

/**
 * Settlement of a Ventes sale — the same sheet as the supermarket till (PosPaymentSheet): cash with the amount handed
 * over, quick notes and the change to give back, or the ScanLinkPay QR the customer scans. A ScanLinkPay payment
 * flips the sale to paid by itself (the parent listens to the sale). "Annuler la vente" when the customer leaves.
 */
export function SalePaymentSheet({
  sale,
  busy,
  error,
  onCash,
  onCancelSale,
  onClose,
}: {
  sale: any;
  busy: 'cash' | 'cancel' | null;
  error: string;
  /** Cash taken; `receivedCents` is what the customer handed over (for the change on the ticket). */
  onCash: (receivedCents: number) => void;
  onCancelSale: () => void;
  onClose: () => void;
}) {
  const online = useOnline();
  const [received, setReceived] = useState('');
  const [showQr, setShowQr] = useState(false);
  const [qr, setQr] = useState('');

  const total = sale.total_cents || 0;
  const currency = sale.currency === 'USD' ? 'USD' : 'CDF';
  const receivedCents = Math.round((parseFloat(received.replace(',', '.')) || 0) * 100);
  const enough = !received || receivedCents >= total;
  const change = Math.max(0, receivedCents - total);
  const payUrl = sale.link_token ? `${publicOrigin()}/p/${sale.link_token}` : '';

  useEffect(() => {
    if (!showQr || !payUrl) return;
    QRCode.toDataURL(payUrl, { width: 320, margin: 2, color: { dark: '#0F172A', light: '#FFFFFF' } })
      .then(setQr)
      .catch(() => setQr(''));
  }, [showQr, payUrl]);

  return (
    <FormSheet onClose={onClose} title="Encaissement">
      <div className="p-6 max-w-lg mx-auto space-y-5">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            {sale.reference} · {(sale.sale_items || []).reduce((n: number, l: any) => n + l.quantity, 0)} article(s)
          </p>
          <p className="text-3xl font-bold text-foreground">{formatCurrency(total, currency)}</p>
          <p className="text-xs text-muted-foreground">à payer</p>
        </div>

        {!online && (
          <div className="flex items-start gap-3 rounded-xl bg-slate-800 px-4 py-3 text-sm text-white dark:bg-slate-700">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Hors ligne : <b>espèces uniquement</b>. L'encaissement est gardé sur cet appareil et envoyé au retour du réseau.</p>
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        {!showQr ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="sale-received">Espèces remises ({currency})</Label>
              <Input
                id="sale-received"
                inputMode="decimal"
                autoComplete="off"
                placeholder={String(total / 100)}
                value={received}
                onChange={(e) => setReceived(e.target.value.replace(/[^\d.,]/g, ''))}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setReceived(String(total / 100))}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent"
                >
                  Appoint
                </button>
                {(currency === 'USD' ? [1, 5, 10, 20, 50, 100] : [1000, 5000, 10000, 20000, 50000]).map((d) => (
                  <button
                    key={d}
                    onClick={() => setReceived(String((parseFloat(received.replace(',', '.')) || 0) + d))}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent"
                  >
                    +{d.toLocaleString('fr-CD')}
                  </button>
                ))}
              </div>
              {change > 0 && (
                <p className="text-sm font-semibold text-success">Monnaie à rendre : {formatCurrency(change, currency)}</p>
              )}
              {!enough && <p className="text-sm font-medium text-destructive">Le montant remis est inférieur au total.</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button onClick={() => onCash(receivedCents || total)} disabled={!!busy || !enough}>
                {busy === 'cash' ? <Loader2 className="mr-2 w-4 h-4 animate-spin" /> : <Banknote className="mr-2 w-4 h-4" />}
                Espèces
              </Button>
              <Button variant="outline" onClick={() => setShowQr(true)} disabled={!!busy || !online || !payUrl}>
                <QrCode className="mr-2 w-4 h-4" />
                ScanLinkPay
              </Button>
            </div>
          </>
        ) : (
          <div className="text-center space-y-4">
            <p className="font-semibold text-foreground">Le client paie via ScanLinkPay</p>
            {qr ? (
              <img src={qr} alt="QR de paiement" className="mx-auto h-56 w-56 rounded-3xl border border-border bg-white p-2" />
            ) : (
              <Loader2 className="mx-auto w-6 h-6 animate-spin text-primary" />
            )}
            <p className="text-sm text-muted-foreground">Le client scanne ce QR avec ScanLinkPay et confirme avec son PIN.</p>
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> En attente du paiement…
            </div>
            <Button variant="outline" className="w-full" onClick={() => setShowQr(false)}>
              Payer autrement
            </Button>
          </div>
        )}

        <button
          onClick={onCancelSale}
          disabled={!!busy || !online}
          className="w-full text-sm font-medium text-destructive hover:underline disabled:opacity-40 disabled:no-underline"
        >
          {busy === 'cancel' ? 'Annulation…' : 'Annuler la vente (le client ne paie pas)'}
        </button>
      </div>
    </FormSheet>
  );
}
