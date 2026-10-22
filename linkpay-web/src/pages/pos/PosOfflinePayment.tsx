import { useState } from 'react';
import { Banknote, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormSheet } from '@/components/FormSheet';
import { formatCurrency } from '@/lib/utils';

/**
 * Payment of a sale made without network: cash only (a ScanLinkPay payment needs the server). The cashier types what
 * the customer hands over, sees the change, confirms; the sale is kept on the device and recorded on the server as
 * soon as the network is back (lib/outbox.ts → POST pos/offline-sales).
 */
export function PosOfflinePaymentSheet({
  totalCents,
  currency,
  onConfirm,
  onClose,
}: {
  totalCents: number;
  currency: string;
  onConfirm: (receivedCents: number) => void;
  onClose: () => void;
}) {
  const [received, setReceived] = useState('');
  const receivedCents = Math.round((parseFloat(received.replace(',', '.')) || 0) * 100);
  const enough = !received || receivedCents >= totalCents;
  const change = Math.max(0, receivedCents - totalCents);

  return (
    <FormSheet onClose={onClose} title="Encaissement hors ligne">
      <div className="mx-auto max-w-lg space-y-5 p-6">
        <div className="flex items-start gap-3 rounded-2xl bg-slate-800 px-4 py-3 text-sm text-white dark:bg-slate-700">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Pas de réseau : <b>espèces uniquement</b>. La vente est gardée sur cet appareil et enregistrée automatiquement au retour du réseau.</p>
        </div>

        <div className="rounded-3xl bg-muted/60 px-4 py-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total à payer</p>
          <p className="mt-1 text-4xl font-extrabold tabular-nums text-foreground">{formatCurrency(totalCents, currency)}</p>
        </div>

        <div>
          <label htmlFor="offline-received" className="mb-1.5 block text-sm font-semibold text-foreground">Montant remis <span className="font-normal text-muted-foreground">(facultatif)</span></label>
          <input
            id="offline-received"
            inputMode="decimal"
            autoComplete="off"
            placeholder={String(totalCents / 100)}
            value={received}
            onChange={(e) => setReceived(e.target.value.replace(/[^\d.,]/g, ''))}
            className="h-14 w-full rounded-xl border border-input bg-background px-4 text-xl font-bold tabular-nums text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <p className={`mt-1.5 min-h-[1.25rem] text-sm ${enough ? 'text-muted-foreground' : 'font-medium text-destructive'}`}>
            {!received ? 'Laissez vide si le client donne le compte juste.' : enough ? <>Monnaie à rendre : <b className="text-foreground">{formatCurrency(change, currency)}</b></> : 'Le montant remis est inférieur au total.'}
          </p>
        </div>

        <Button className="h-[52px] w-full rounded-xl text-base font-semibold" disabled={!enough} onClick={() => onConfirm(receivedCents || totalCents)}>
          <Banknote className="mr-2 h-5 w-5" /> Encaisser en espèces
        </Button>
      </div>
    </FormSheet>
  );
}
