import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { DualCurrencyStat } from '@/components/DualCurrencyStat';
import { cn } from '@/lib/utils';

interface StatTileProps {
  icon: LucideIcon;
  label: string;
  value?: ReactNode;
  money?: { CDF: number; USD: number };
  subtitle?: string;
  onClick?: () => void;
  className?: string;
}

/** Compact dashboard tile — everything stays inside the card (long amounts wrap instead of overflowing). */
export function StatTile({ icon: Icon, label, value, money, subtitle, onClick, className }: StatTileProps) {
  const body = (
    <>
      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center mb-2.5">
        <Icon className="w-[18px] h-[18px] text-primary" />
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground truncate">{label}</p>
      {money ? (
        <DualCurrencyStat amounts={money} compact className="mt-1" />
      ) : value !== undefined ? (
        <p className="mt-1 text-[15px] font-bold leading-tight text-foreground [overflow-wrap:anywhere]">{value}</p>
      ) : null}
      {subtitle && <p className="mt-1 text-xs text-muted-foreground truncate">{subtitle}</p>}
    </>
  );

  const base = cn('min-w-0 overflow-hidden p-3.5 text-left', className);

  if (onClick) {
    return (
      <Card
        className={cn(base, 'cursor-pointer transition-all hover:border-primary/30 hover:shadow-card-hover active:scale-[0.98]')}
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
      >
        {body}
      </Card>
    );
  }

  return <Card className={base}>{body}</Card>;
}
