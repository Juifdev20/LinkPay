import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { MOBILE_MONEY_OPERATORS } from '@/lib/constants';

interface MobileMoneyOperatorPickerProps {
  value: string;
  onChange: (operator: string) => void;
  className?: string;
}

export function MobileMoneyOperatorPicker({ value, onChange, className }: MobileMoneyOperatorPickerProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label className="font-semibold">Opérateur</Label>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {MOBILE_MONEY_OPERATORS.map((op) => (
          <button
            key={op.value}
            type="button"
            onClick={() => onChange(op.value)}
            className={cn(
              'rounded-lg border px-2 py-2 text-xs font-medium transition-colors',
              value === op.value
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-input text-muted-foreground hover:bg-accent',
            )}
          >
            {op.label}
          </button>
        ))}
      </div>
    </div>
  );
}
