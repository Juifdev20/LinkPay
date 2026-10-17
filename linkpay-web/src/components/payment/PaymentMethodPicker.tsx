import { Check, CreditCard, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MOBILE_MONEY_OPERATORS } from '@/lib/mobile-money';

export type PaymentMethodId = 'mobile_money' | 'card' | 'wallet';

interface Option {
  id: PaymentMethodId;
  title: string;
  subtitle: string;
  visual: React.ReactNode;
  disabled?: boolean;
  badge?: string;
}

const MOBILE_MONEY_VISUAL = (
  <div className="flex -space-x-2.5">
    {MOBILE_MONEY_OPERATORS.map((o) => (
      <img key={o.id} src={o.logo} alt="" className="h-9 w-9 rounded-full object-cover ring-2 ring-card" />
    ))}
  </div>
);

const tile = (children: React.ReactNode, tone: string) => (
  <div className={cn('flex h-11 w-11 items-center justify-center rounded-xl', tone)}>{children}</div>
);

interface PaymentMethodPickerProps {
  value: PaymentMethodId;
  onChange: (m: PaymentMethodId) => void;
  /** Which methods to offer, in order. */
  methods: PaymentMethodId[];
  /** "Solde disponible : 10 000,00 CDF" under the wallet option. */
  walletNote?: string;
  /** A method shown but not usable yet (the card payment, for now). */
  disabled?: PaymentMethodId[];
}

/**
 * The "how do you want to pay" choice, the same everywhere: one large row per method, with the logos of the operators
 * for Mobile Money. A method that is not available yet is shown greyed with "Bientôt" — never a choice that looks
 * like it works.
 */
export function PaymentMethodPicker({ value, onChange, methods, walletNote, disabled = [] }: PaymentMethodPickerProps) {
  const catalog: Record<PaymentMethodId, Option> = {
    mobile_money: { id: 'mobile_money', title: 'Mobile Money', subtitle: 'Airtel, Orange, M-Pesa', visual: MOBILE_MONEY_VISUAL },
    card: { id: 'card', title: 'Carte bancaire', subtitle: 'Visa, Mastercard, Amex, Diners', visual: tile(<CreditCard className="h-5 w-5 text-primary" />, 'bg-primary/10'), badge: 'Bientôt' },
    wallet: { id: 'wallet', title: 'Solde ScanLinkPay', subtitle: walletNote ?? 'Payez avec votre portefeuille', visual: tile(<Wallet className="h-5 w-5 text-primary" />, 'bg-primary/10') },
  };

  return (
    <div role="radiogroup" aria-label="Mode de paiement" className="space-y-2.5">
      {methods.map((id) => {
        const o = catalog[id];
        const off = disabled.includes(id);
        const selected = value === id && !off;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={off}
            onClick={() => onChange(id)}
            className={cn(
              'flex w-full items-center gap-3.5 rounded-2xl border-2 px-4 py-3.5 text-left transition-all',
              selected ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-card hover:border-primary/40',
              off && 'cursor-not-allowed opacity-55 hover:border-border',
            )}
          >
            <div className="flex h-11 min-w-[44px] shrink-0 items-center">{o.visual}</div>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold leading-tight text-foreground">{o.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{o.subtitle}</p>
            </div>
            {off && o.badge ? (
              <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{o.badge}</span>
            ) : (
              <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors', selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
                {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
