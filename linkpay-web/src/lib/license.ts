import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { STAFF_ROLES } from '@/lib/nav-items';

export type FeatureStatus = 'active' | 'trial' | 'expired' | 'none';

export interface FeatureState {
  key: string;
  name: string;
  description: string | null;
  status: FeatureStatus;
  expires_at: string | null;
  days_left: number | null;
  mode: 'read_only' | 'blocked';
  prices: Record<string, number>;
}

export interface LicenseState {
  organization_id: string;
  trial: { ends_at: string; active: boolean; days_left: number };
  settings: { trial_end_mode: 'read_only' | 'blocked'; expiry_mode: 'read_only' | 'blocked' };
  features: FeatureState[];
  bundle_prices: Record<string, number>;
}

/** Which licensed feature a screen belongs to — mirrors the @RequireLicense decorators in the API. */
export const ROUTE_FEATURE = {
  pos: 'pos',
  sales: 'sales',
  stock: 'stock',
  inventory: 'inventory',
  stats: 'stats',
  audit: 'audit',
  staff: 'staff',
} as const;

export type LicenseFeatureKey = keyof typeof ROUTE_FEATURE;

/** The licence status of the signed-in user's business; undefined for roles/accounts it doesn't apply to. */
export function useLicense() {
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
    queryKey: ['license-state', org?.id],
    queryFn: async () => (await api.get(`/licenses/organizations/${org.id}`)).data as LicenseState,
    enabled: applies && !!org?.id,
    staleTime: 30_000,
    retry: false,
  });
  return { ...query, orgId: org?.id as string | undefined, isOwner: role === 'enterprise', applies };
}

export function featureOf(state: LicenseState | undefined, key: string) {
  return state?.features.find((f) => f.key === key);
}

/** Can the screen be used at all (reading counts)? */
export const isUsable = (f?: FeatureState) => !f || f.status === 'active' || f.status === 'trial' || f.mode === 'read_only';
/** Can the person change things on it? */
export const isWritable = (f?: FeatureState) => !f || f.status === 'active' || f.status === 'trial';
