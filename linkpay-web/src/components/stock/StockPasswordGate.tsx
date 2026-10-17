import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useStockPasswordPrompt } from '@/lib/stock-password-prompt';
import { StockPasswordDialog } from './StockPasswordDialog';

/**
 * Mounted once in App.tsx. When the API demands the patron's stock password
 * (adding stock, recording a movement, validating an inventory) the API client
 * opens this dialog, then repeats the request with the password.
 */
export function StockPasswordGate() {
  const { open, answer } = useStockPasswordPrompt();
  const user = useAuthStore((s) => s.user);

  // Staff carry their organization in their profile; the patron's is fetched.
  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
    enabled: open && !user?.organization_id,
  });
  const orgId = user?.organization_id || org?.id;

  if (!open || !orgId) return null;
  return <StockPasswordDialog orgId={orgId} open onClose={() => answer(null)} onUnlocked={(password) => answer(password)} />;
}
