import { useMemo, useState } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { TransactionItem } from '@/components/TransactionItem';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

const PAGE_SIZE = 20;

export type Preset = 'today' | 'week' | 'month' | 'year' | 'all' | 'custom';

export const PRESETS: { value: Preset; label: string }[] = [
  { value: 'all', label: 'Tout' },
  { value: 'today', label: "Aujourd'hui" },
  { value: 'week', label: 'Cette semaine' },
  { value: 'month', label: 'Ce mois' },
  { value: 'year', label: 'Cette année' },
  { value: 'custom', label: 'Date précise' },
];

/** [from, to) bounds for a preset, in local time — `to` is exclusive (the
 * instant the next period starts), matching the backend's `.lt('created_at',
 * to)` so the boundary day is never double-counted or dropped. */
export function presetRange(preset: Preset, customDate: string): { from?: string; to?: string } {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

  switch (preset) {
    case 'today': {
      const from = startOfDay(now);
      return { from: from.toISOString(), to: addDays(from, 1).toISOString() };
    }
    case 'week': {
      const from = addDays(startOfDay(now), -6);
      return { from: from.toISOString(), to: addDays(startOfDay(now), 1).toISOString() };
    }
    case 'month': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    case 'year': {
      const from = new Date(now.getFullYear(), 0, 1);
      const to = new Date(now.getFullYear() + 1, 0, 1);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    case 'custom': {
      if (!customDate) return {};
      const from = new Date(`${customDate}T00:00:00`);
      return { from: from.toISOString(), to: addDays(from, 1).toISOString() };
    }
    default:
      return {};
  }
}

/**
 * Full sales history for the (single) business this enterprise account
 * owns — the mobile BottomNav "Transactions" tab destination for the
 * enterprise role, replacing MerchantTransactionsPage (which needs a
 * merchant_id the plain enterprise JWT doesn't carry). Day/week/month/year
 * presets plus an exact-date picker, per product request.
 */
export default function OrganizationTransactionsPage() {
  const [preset, setPreset] = useState<Preset>('all');
  const [customDate, setCustomDate] = useState('');

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
  });

  const range = useMemo(() => presetRange(preset, customDate), [preset, customDate]);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['org-transactions', org?.id, range.from, range.to],
    queryFn: async ({ pageParam = 1 }) => {
      const { data } = await api.get(`/organizations/${org.id}/transactions`, {
        params: { page: pageParam, limit: PAGE_SIZE, from: range.from, to: range.to },
      });
      return data as { items: any[]; total: number };
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => (pages.length * PAGE_SIZE < lastPage.total ? pages.length + 1 : undefined),
    enabled: !!org?.id,
  });

  const transactions = data?.pages.flatMap((p) => p.items) || [];
  const total = data?.pages[0]?.total ?? 0;

  return (
    <div className="p-6 space-y-4 max-w-2xl mx-auto">
      <PageHeader title="Transactions" />

      <div className="flex gap-2 overflow-x-auto pb-1">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPreset(p.value)}
            className={cn('flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-medium border', preset === p.value ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground')}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <Input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} max={new Date().toISOString().slice(0, 10)} />
      )}

      <Card>
        <CardContent className="pt-5">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : transactions.length ? (
            <div>
              <p className="text-xs text-muted-foreground mb-2">{total} transaction{total > 1 ? 's' : ''}</p>
              {transactions.map((t: any) => (
                <TransactionItem
                  key={t.id}
                  name={t.merchant?.name || 'Boutique'}
                  amountCents={t.amount_cents}
                  currency={t.currency}
                  status={t.status}
                  date={t.created_at}
                  type="in"
                />
              ))}

              {hasNextPage && (
                <Button variant="outline" className="w-full mt-4" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                  {isFetchingNextPage && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                  Charger plus
                </Button>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              {preset === 'custom' && !customDate ? 'Choisis une date' : 'Aucune transaction pour cette période'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
