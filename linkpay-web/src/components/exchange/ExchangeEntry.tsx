import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight } from 'lucide-react';
import { ShortcutButton } from '@/components/ShortcutButton';
import { useExchangeState } from '@/hooks/useExchangeState';
import { useOnline } from '@/lib/network';

/**
 * « Bureau d'échange » on the home screen: the same solid button as « Mes dépenses », OUTSIDE the balance card (so the
 * card and its four actions stay exactly as they were), right above the other shortcuts. Nothing at all while the
 * service is off or for an account that may not use it.
 */
export function ExchangeEntry() {
  const navigate = useNavigate();
  const { visible } = useExchangeState();
  const online = useOnline();
  if (!visible) return null;
  // Needs the server (guaranteed rate, two balances at once): without network the button still opens, and says why.
  return <ShortcutButton icon={ArrowLeftRight} label="Bureau d'échange" hint={online ? undefined : 'Internet requis'} onClick={() => navigate('/dashboard/exchange')} />;
}
