import { Button } from '@/components/ui/button';
import { ResultView, ResultCard } from '@/components/ResultView';
import { formatCurrency } from '@/lib/utils';

export type TopupCardStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'TIMEDOUT';

interface Row {
  label: string;
  value: string;
}

interface TopupStatusCardProps {
  status: TopupCardStatus;
  amountCents: number;
  currency: 'CDF' | 'USD';
  extraRows?: Row[];
  reference?: string;
  onBack: () => void;
  /** What the card talks about — a wallet top-up (default) or a PSP-funded send. */
  kind?: 'topup' | 'transfer';
}

/**
 * Shared success/pending/failed/timed-out card for a wallet top-up outcome —
 * used both by Topup.tsx (a synchronous result, e.g. an idempotent replay) and
 * TopupResult.tsx (the page the payment provider sends the user back to, driven by
 * status polling). `kind="transfer"` swaps the wording for a PSP-funded
 * person-to-person send (Send.tsx / SendResult.tsx).
 */
export function TopupStatusCard({ status, amountCents, currency, extraRows = [], reference, onBack, kind = 'topup' }: TopupStatusCardProps) {
  const isFailed = status === 'FAILED';
  const isPending = status === 'PENDING' || status === 'TIMEDOUT';
  const isTransfer = kind === 'transfer';

  const title = isFailed
    ? (isTransfer ? 'Envoi échoué' : 'Recharge échouée')
    : status === 'TIMEDOUT'
    ? 'Toujours en cours de traitement'
    : status === 'PENDING'
    ? 'En attente de confirmation'
    : (isTransfer ? 'Envoi réussi' : 'Recharge réussie');

  const description = isFailed
    ? (isTransfer ? "Cet envoi n'a pas abouti — aucun montant n'a été débité. Vous pouvez réessayer." : "Cette recharge n'a pas abouti. Vous pouvez réessayer depuis votre tableau de bord.")
    : status === 'TIMEDOUT'
    ? (isTransfer ? 'Cet envoi met plus de temps que prévu à se confirmer. Il pourra tout de même aboutir — le destinataire sera crédité dès que ce sera fait.' : 'Cette recharge met plus de temps que prévu à se confirmer. Elle pourra tout de même aboutir — votre solde sera mis à jour dès que ce sera fait.')
    : status === 'PENDING'
    ? (isTransfer ? 'Votre envoi est en cours de traitement. Le destinataire sera crédité après confirmation.' : 'Votre recharge est en cours de traitement. Le solde sera mis à jour après confirmation.')
    : (isTransfer ? 'Le destinataire a été crédité.' : 'Le montant a été ajouté à votre solde ScanLinkPay.');

  const statusLabel = isFailed ? 'Échoué' : isPending ? 'En attente' : 'Confirmé';
  const statusColor = isFailed ? 'text-destructive' : isPending ? 'text-warning' : 'text-success';

  return (
    <ResultCard>
      <ResultView
        tone={isFailed ? 'error' : status === 'PENDING' ? 'pending' : status === 'TIMEDOUT' ? 'waiting' : 'success'}
        title={title}
        amount={formatCurrency(amountCents, currency)}
        message={description}
        rows={[
          ...extraRows,
          { label: 'Statut', value: statusLabel, className: statusColor },
          ...(reference ? [{ label: 'Référence', value: reference, copy: reference }] : []),
        ]}
      >
        <Button className="h-[52px] w-full rounded-xl text-base font-semibold" onClick={onBack}>
          Retour à l'accueil
        </Button>
      </ResultView>
    </ResultCard>
  );
}
