import { Link } from 'react-router-dom';
import { ArrowLeftRight, ChevronRight } from 'lucide-react';
import { useExchangeState } from '@/hooks/useExchangeState';
import { givenToReceive, otherCurrency, type Currency } from '@/lib/exchange';
import { formatCurrency } from '@/lib/utils';

/**
 * « Solde insuffisant en francs, mais vous avez des dollars »: shown under the amount of a withdrawal or a send when
 * the chosen currency is short, the OTHER one would cover it, and the person may use the Bureau d'échange right now.
 * One tap opens the exchange with the amount to give already filled in. Nothing otherwise (and never a nag for
 * someone whose account is not validated).
 */
export function ExchangeSuggestion({ currency, amountCents, balances }: { currency: Currency; amountCents: number; balances?: Record<Currency, number> | null }) {
  const { data: state, visible } = useExchangeState();
  if (!visible || !state?.available || !state.rates || !balances || amountCents <= 0) return null;

  const have = balances[currency] ?? 0;
  const shortfall = amountCents - have;
  if (shortfall <= 0) return null;

  const other = otherCurrency(currency);
  const otherHave = balances[other] ?? 0;
  const give = givenToReceive(other, shortfall, state.rates);
  if (give > otherHave || give <= 0) return null;

  const need = Math.ceil(shortfall / 100);
  return (
    <Link
      to={`/dashboard/exchange?from=${other}&need=${need}`}
      className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-3.5 text-left transition-colors hover:bg-primary/10"
    >
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><ArrowLeftRight className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1 text-sm">
        <span className="block font-semibold text-foreground">Il vous manque {formatCurrency(shortfall, currency).replace(/,00(?=\s)/, '')}</span>
        <span className="block text-xs text-muted-foreground">Vous avez {formatCurrency(otherHave, other)} : changez-en une partie au Bureau d'échange.</span>
      </span>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
    </Link>
  );
}
