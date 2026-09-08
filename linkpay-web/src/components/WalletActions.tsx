import { Link } from 'react-router-dom';
import { ArrowDownToLine, Send, ScanLine, ArrowUpFromLine } from 'lucide-react';

interface WalletActionsProps {
  /** Preselects this currency in each flow (e.g. whichever tab is active on BalanceCard) — the flow's own currency step still lets the user change it. */
  currency?: 'CDF' | 'USD';
}

/** Action row for BalanceCard's `actions` slot when it's showing a wallet. */
export function WalletActions({ currency }: WalletActionsProps) {
  const suffix = currency ? `?currency=${currency}` : '';
  const actions = [
    { to: `/dashboard/wallet/topup${suffix}`, icon: ArrowDownToLine, label: 'Recharger' },
    { to: `/dashboard/wallet/send${suffix}`, icon: Send, label: 'Envoyer' },
    { to: '/dashboard/wallet/pay', icon: ScanLine, label: 'Payer' },
    { to: `/dashboard/wallet/withdraw${suffix}`, icon: ArrowUpFromLine, label: 'Retirer' },
  ];

  return (
    <div className="grid grid-cols-4 gap-2 w-full">
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
