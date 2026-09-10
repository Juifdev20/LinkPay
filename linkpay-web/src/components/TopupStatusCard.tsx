import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Check, XCircle } from 'lucide-react';
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
}

/**
 * Shared success/pending/failed/timed-out card for a wallet top-up outcome —
 * used both by Topup.tsx (mock provider's synchronous result) and
 * TopupResult.tsx (the page a real CinetPay redirect lands on, driven by
 * status polling).
 */
export function TopupStatusCard({ status, amountCents, currency, extraRows = [], reference, onBack }: TopupStatusCardProps) {
  const isFailed = status === 'FAILED';
  const isPending = status === 'PENDING' || status === 'TIMEDOUT';

  const icon = isFailed
    ? <XCircle className="w-8 h-8 text-destructive" />
    : isPending
    ? <Loader2 className={`w-8 h-8 text-warning ${status === 'PENDING' ? 'animate-spin' : ''}`} />
    : <Check className="w-8 h-8 text-success" />;

  const iconBg = isFailed ? 'bg-destructive/10' : isPending ? 'bg-warning/10' : 'bg-success/10';

  const title = isFailed
    ? 'Recharge échouée'
    : status === 'TIMEDOUT'
    ? 'Toujours en cours de traitement'
    : status === 'PENDING'
    ? 'En attente de confirmation'
    : 'Recharge réussie !';

  const description = isFailed
    ? "Cette recharge n'a pas abouti. Vous pouvez réessayer depuis votre tableau de bord."
    : status === 'TIMEDOUT'
    ? 'Cette recharge met plus de temps que prévu à se confirmer. Elle pourra tout de même aboutir — votre solde sera mis à jour dès que ce sera fait.'
    : status === 'PENDING'
    ? `Votre recharge de ${formatCurrency(amountCents, currency)} est en cours de traitement. Le solde sera mis à jour après confirmation.`
    : `${formatCurrency(amountCents, currency)} ajouté(s) à votre compte LinkPay`;

  const statusLabel = isFailed ? 'Échouée' : isPending ? 'En attente' : 'Confirmé';
  const statusColor = isFailed ? 'text-destructive' : isPending ? 'text-warning' : 'text-success';

  return (
    <div className="p-6 max-w-lg mx-auto">
      <Card>
        <CardContent className="pt-6 text-center">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${iconBg}`}>
            {icon}
          </div>
          <h2 className="text-xl font-bold text-foreground mb-1">{title}</h2>
          <p className="text-sm text-muted-foreground mb-6">{description}</p>
          <div className="rounded-xl bg-secondary p-4 text-left space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Montant</span>
              <span className="font-semibold text-foreground">{formatCurrency(amountCents, currency)}</span>
            </div>
            {extraRows.map((row) => (
              <div key={row.label} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-semibold text-foreground">{row.value}</span>
              </div>
            ))}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Statut</span>
              <span className={`font-semibold ${statusColor}`}>{statusLabel}</span>
            </div>
            {reference && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Référence</span>
                <span className="font-mono text-xs text-foreground truncate ml-2">{reference}</span>
              </div>
            )}
          </div>
          <Button className="w-full mt-6" size="lg" onClick={onBack}>
            Retour au tableau de bord
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
