import { Loader2 } from 'lucide-react';
import { PaymentStep } from '@/components/payment/PaymentStep';
import { displayPhone, operatorById } from '@/lib/mobile-money';
import { formatCurrency } from '@/lib/utils';

interface MobileMoneyWaitingProps {
  operator: string;
  /** The 9 national digits. */
  phone: string;
  amountCents: number;
  currency: 'CDF' | 'USD';
}

/**
 * "Confirm on your phone": the Mobile Money request was sent, the person validates it with their own secret code
 * (ScanLinkPay never sees it). The same screen on every payment that goes through Mobile Money.
 */
export function MobileMoneyWaiting({ operator, phone, amountCents, currency }: MobileMoneyWaitingProps) {
  const op = operatorById(operator);
  return (
    <PaymentStep title="Confirmez sur votre téléphone" subtitle={`Demande ${op?.short ?? 'Mobile Money'} envoyée au ${displayPhone(phone)}`}>
      <div className="flex flex-col items-center py-2">
        <div className="relative">
          <span className="absolute inset-0 animate-ping rounded-3xl bg-primary/20" />
          {op && <img src={op.logo} alt="" className="relative h-20 w-20 rounded-3xl object-cover shadow-lg" />}
        </div>
        <p className="mt-5 text-3xl font-bold tabular-nums text-foreground">{formatCurrency(amountCents, currency)}</p>
      </div>
      <ol className="space-y-3 rounded-2xl bg-secondary/60 p-4 text-sm">
        {["Ouvrez la demande qui vient d'arriver sur votre téléphone", 'Entrez votre code secret Mobile Money', 'Le paiement est enregistré dès votre confirmation'].map((t, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
            <span className="pt-0.5 text-foreground">{t}</span>
          </li>
        ))}
      </ol>
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" /> En attente de votre confirmation…
      </div>
    </PaymentStep>
  );
}
