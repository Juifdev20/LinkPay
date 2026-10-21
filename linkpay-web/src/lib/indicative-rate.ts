import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

/**
 * The indicative CDF/USD rate set by the super admin (null = not set). Display only — "≈ 5,12 $US" under an amount;
 * CDF and USD stay two separate balances and nothing is ever converted.
 */
export function useIndicativeRate(): number | null {
  const { data } = useQuery<{ cdf_per_usd?: number | null }>({
    queryKey: ['platform-settings-public'],
    queryFn: async () => (await api.get('/platform/settings')).data,
    staleTime: 10 * 60_000,
  });
  return data?.cdf_per_usd ?? null;
}

/** "≈ 5,12 $US" for an amount in CDF cents, "≈ 28 500 CDF" for USD cents; null without a rate. */
export function indicativeOther(cents: number, currency: 'CDF' | 'USD', rate: number | null): string | null {
  if (!rate || !cents) return null;
  const other = currency === 'CDF' ? cents / 100 / rate : (cents / 100) * rate;
  const digits = currency === 'CDF' ? 2 : 0;
  const text = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(other);
  return `≈ ${text} ${currency === 'CDF' ? '$US' : 'CDF'}`;
}
