import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { STAFF_ROLES } from '@/lib/nav-items';

/** active: paid and running · trial: free trial · expired: was paid, ended · none: trial over, never paid */
export type SubscriptionStatus = 'active' | 'trial' | 'expired' | 'none';

export interface SubscriptionState {
  organization_id: string;
  status: SubscriptionStatus;
  /** What happens to the business tools when the status is expired / none. */
  mode: 'read_only' | 'blocked';
  expires_at: string | null;
  days_left: number | null;
  trial: { ends_at: string; active: boolean; days_left: number };
  settings: { trial_end_mode: 'read_only' | 'blocked'; expiry_mode: 'read_only' | 'blocked' };
  /** Price of one month per currency, in cents. */
  prices: Record<string, number>;
}

/** The subscription of the signed-in user's business; nothing for accounts it doesn't apply to. */
export function useSubscription() {
  const user = useAuthStore((s) => s.user);
  const role = user?.acting_as_org_id ? 'enterprise' : user?.role;
  const applies = !!role && (role === 'enterprise' || STAFF_ROLES.includes(role));

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
    enabled: applies,
    retry: false,
  });
  const query = useQuery({
    queryKey: ['subscription-state', org?.id],
    queryFn: async () => (await api.get(`/subscriptions/organizations/${org.id}`)).data as SubscriptionState,
    enabled: applies && !!org?.id,
    staleTime: 30_000,
    retry: false,
  });
  return { ...query, orgId: org?.id as string | undefined, isOwner: role === 'enterprise', applies };
}

/** Can the screens be used at all (reading counts)? */
export const isUsable = (s?: SubscriptionState) => !s || s.status === 'active' || s.status === 'trial' || s.mode === 'read_only';
/** Can the person change things? */
export const isWritable = (s?: SubscriptionState) => !s || s.status === 'active' || s.status === 'trial';
