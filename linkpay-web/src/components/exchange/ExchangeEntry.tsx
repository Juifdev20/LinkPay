import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight } from 'lucide-react';
import { ShortcutButton } from '@/components/ShortcutButton';
import { useExchangeState } from '@/hooks/useExchangeState';

/**
 * « Bureau d'échange » on the home screen: the same solid button as « Mes dépenses », OUTSIDE the balance card (so the
 * card and its four actions stay exactly as they were), right above the other shortcuts. Nothing at all while the
 * service is off or for an account that may not use it.
 */
export function ExchangeEntry() {
  const navigate = useNavigate();
  const { visible } = useExchangeState();
  if (!visible) return null;
  return <ShortcutButton icon={ArrowLeftRight} label="Bureau d'échange" onClick={() => navigate('/dashboard/exchange')} />;
}
