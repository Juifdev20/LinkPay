import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Smartphone, CreditCard } from 'lucide-react';

interface PaymentMethodSelectorProps {
  value: 'mobile_money' | 'card';
  onChange: (method: 'mobile_money' | 'card') => void;
  className?: string;
}

/** Mobile Money (functional, via the mock/real PSP) vs Carte bancaire (always shown, always "Bientôt" — never let a disabled channel look like it works). */
export function PaymentMethodSelector({ value, onChange, className }: PaymentMethodSelectorProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label className="font-semibold">Mode de paiement</Label>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => onChange('mobile_money')}
          className={cn(
            'flex flex-col items-center gap-1.5 rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-colors',
            value === 'mobile_money'
              ? 'border-primary bg-primary/5 text-primary'
              : 'border-input text-muted-foreground hover:bg-accent',
          )}
        >
          <Smartphone className="w-5 h-5" />
          Mobile Money
        </button>
        <button
          type="button"
          disabled
          title="Bientôt disponible"
          className="flex flex-col items-center gap-1.5 rounded-xl border-2 border-input px-4 py-3 text-sm font-semibold text-muted-foreground/50 cursor-not-allowed relative"
        >
          <CreditCard className="w-5 h-5" />
          Carte bancaire
          <span className="absolute -top-2 right-2 text-[10px] font-bold bg-secondary text-muted-foreground px-1.5 py-0.5 rounded-full">
            Bientôt
          </span>
        </button>
      </div>
    </div>
  );
}
