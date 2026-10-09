import { Link } from 'react-router-dom';
import { useAuthStore } from '@/lib/auth-store';
import { ArrowDownToLine, Send, ScanLine, ArrowUpFromLine } from 'lucide-react';

interface WalletActionsProps {
  /** Preselects this currency in each flow (e.g. whichever tab is active on BalanceCard) — the flow's own currency step still lets the user change it. */
  currency?: 'CDF' | 'USD';
}

/** Action row for BalanceCard's `actions` slot when it's showing a wallet. */
export function WalletActions({ currency }: WalletActionsProps) {
  const role = useAuthStore((s) => s.user?.role);
  // Staff (merchant cashier, vendeur, caissier, magasinier, comptable) never withdraw: only the patron does.
  const mayWithdraw = !['cashier', 'vendeur', 'caissier', 'magasinier', 'comptable'].includes(role || '');
  const suffix = currency ? `?currency=${currency}` : '';
  const actions = [
    { to: `/dashboard/wallet/topup${suffix}`, icon: ArrowDownToLine, label: 'Recharger' },
    { to: `/dashboard/wallet/send${suffix}`, icon: Send, label: 'Envoyer' },
    { to: '/dashboard/wallet/pay', icon: ScanLine, label: 'Payer' },
    ...(mayWithdraw ? [{ to: `/dashboard/wallet/withdraw${suffix}`, icon: ArrowUpFromLine, label: 'Retirer' }] : []),
  ];

  return (
    <div className={`grid gap-2 w-full ${actions.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
      {actions.map((a) => (
        <Link
          key={a.to}
          to={a.to}
          className="flex flex-col items-center gap-1.5 rounded-xl bg-white/20 hover:bg-white/30 py-3 transition-colors"
        >
          <a.icon className="w-5 h-5" />
          <span className="text-xs font-semibold">{a.label}</span>
        </Link>
      ))}
    </div>
  );
}
