import { Store, Layers } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';

export interface StationSummary {
  id: string;
  name: string;
  /** Today's till takings per currency (stores-breakdown today_pos_sales). */
  today?: Record<string, number>;
}

/**
 * The owner's station picker: "Toutes les stations" or one station, each
 * with what it took today. A horizontal strip of chips that scrolls on a
 * phone. Shown only to the owner, and only once there is more than one station.
 */
export function StationSwitcher({
  stations,
  value,
  onChange,
  currency,
}: {
  stations: StationSummary[];
  value: string | null;
  onChange: (id: string | null) => void;
  currency: 'CDF' | 'USD';
}) {
  if (stations.length < 2) return null;
  const total = stations.reduce((sum, s) => sum + (s.today?.[currency] || 0), 0);
  const chips = [
    { id: null as string | null, name: 'Toutes les stations', amount: total, icon: Layers },
    ...stations.map((s) => ({ id: s.id as string | null, name: s.name, amount: s.today?.[currency] || 0, icon: Store })),
  ];

  return (
    <div className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0" role="tablist" aria-label="Station affichée">
      <div className="flex w-max gap-2">
        {chips.map((c) => {
          const active = c.id === value;
          const Icon = c.icon;
          return (
            <button
              key={c.id ?? 'all'}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(c.id)}
              className={cn(
                'flex min-w-[9.5rem] flex-col items-start rounded-2xl border px-3.5 py-2.5 text-left transition-colors',
                active ? 'border-primary bg-primary text-primary-foreground shadow-md shadow-primary/20' : 'border-border bg-card text-foreground hover:bg-accent',
              )}
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <Icon className="h-3.5 w-3.5" />
                <span className="max-w-[9rem] truncate">{c.name}</span>
              </span>
              <span className={cn('mt-1 text-sm font-bold', active ? 'text-primary-foreground' : 'text-foreground')}>
                {formatCurrency(c.amount, currency)}
              </span>
              <span className={cn('text-[11px]', active ? 'text-primary-foreground/80' : 'text-muted-foreground')}>Recette du jour</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
