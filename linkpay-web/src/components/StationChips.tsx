import { cn } from '@/lib/utils';

/**
 * The owner's station filter for a selling screen: « Toutes les stations » (optional) and one chip per station.
 * The choice is the one shared across the owner's screens (useStationScope), so what is picked on the home
 * dashboard is what the sales screen opens on, and the other way round.
 */
export function StationChips({
  stations,
  value,
  onChange,
  allowAll = true,
}: {
  stations: { id: string; name: string }[];
  /** The station id picked, or null for every station. */
  value: string | null;
  onChange: (id: string | null) => void;
  /** False where a sale needs one station (the till): no « Toutes les stations » chip. */
  allowAll?: boolean;
}) {
  if (stations.length < 2) return null;
  const chip = (active: boolean) =>
    cn(
      'flex-shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition-colors',
      active ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-foreground/30',
    );
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0" role="tablist" aria-label="Station">
      <div className="flex w-max gap-2">
        {allowAll && (
          <button role="tab" aria-selected={value === null} onClick={() => onChange(null)} className={chip(value === null)}>
            Toutes les stations
          </button>
        )}
        {stations.map((s) => (
          <button key={s.id} role="tab" aria-selected={value === s.id} onClick={() => onChange(s.id)} className={chip(value === s.id)}>
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}
