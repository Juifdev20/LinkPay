import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import type { ExchangeState } from '@/lib/exchange';

/** The accounts the Bureau d'échange is for (the server decides again): clients, shops, business owners. Never employees. */
const ELIGIBLE_ROLES = ['client', 'merchant', 'enterprise'];

/**
 * What the app knows about the Bureau d'échange for the signed-in person (GET /exchange): whether the button should
 * exist at all, whether their account is validated, the rates and the limits. One shared query: the home screen,
 * the « Plus » menu and the exchange page all read the same answer.
 */
export function useExchangeState() {
  const role = useAuthStore((s) => s.user?.role);
  const eligibleRole = !!role && ELIGIBLE_ROLES.includes(role);
  const query = useQuery<ExchangeState>({
    queryKey: ['exchange'],
    queryFn: async () => (await api.get('/exchange')).data,
    enabled: eligibleRole,
    staleTime: 30_000,
    retry: false,
  });
  return {
    ...query,
    /** The button / menu entry is shown: the account type is allowed AND the team switched the service on. */
    visible: eligibleRole && !!query.data?.eligible && !!query.data?.enabled,
  };
}
