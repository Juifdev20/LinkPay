import { Link } from 'react-router-dom';
import { ArrowDownToLine, Send, ScanLine, ArrowUpFromLine } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Action row for BalanceCard's `actions` slot when it's showing a wallet.
 * Only "Recharger" is wired to a real endpoint (Phase 1) — the other three
 * are visible so users know what's coming, but disabled with a "Bientôt"
 * badge rather than silently doing nothing, so nobody mistakes them for a
 * working feature.
 */
export function WalletActions() {
  return (
    <div className="grid grid-cols-4 gap-2 w-full">
      <Link
        to="/dashboard/wallet/topup"
        className="flex flex-col items-center gap-1.5 rounded-xl bg-white/20 hover:bg-white/30 py-3 transition-colors"
      >
        <ArrowDownToLine className="w-5 h-5" />
        <span className="text-xs font-semibold">Recharger</span>
      </Link>
      <WalletActionPlaceholder icon={Send} label="Envoyer" />
      <WalletActionPlaceholder icon={ScanLine} label="Payer" />
      <WalletActionPlaceholder icon={ArrowUpFromLine} label="Retirer" />
    </div>
  );
}

function WalletActionPlaceholder({ icon: Icon, label }: { icon: typeof Send; label: string }) {
  return (
    <div
      className={cn(
        'relative flex flex-col items-center gap-1.5 rounded-xl bg-white/10 py-3 opacity-60 cursor-not-allowed',
      )}
      title="Bientôt disponible"
    >
      <Icon className="w-5 h-5" />
      <span className="text-xs font-semibold">{label}</span>
      <span className="absolute -top-1.5 -right-1 rounded-full bg-white/90 px-1.5 py-0.5 text-[9px] font-bold leading-none text-primary">
        Bientôt
      </span>
    </div>
  );
}
