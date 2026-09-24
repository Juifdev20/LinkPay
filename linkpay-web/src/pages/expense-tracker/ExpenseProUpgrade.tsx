import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PinInput } from '@/components/PinInput';
import { formatCurrency } from '@/lib/utils';
import { Loader2, Crown, Wallet, CreditCard } from 'lucide-react';

interface ExpenseProUpgradeProps {
  status: { monthly_price_cents: number; monthly_price_currency: 'CDF' | 'USD' };
  /** 'choice': shown on first-ever access, alongside the trial option. 'paywall': shown after the trial limit / Pro period has run out. Same activation logic either way — only the copy changes. */
  context?: 'choice' | 'paywall';
}

/**
 * Two activation paths, same choice already offered for wallet top-ups:
 * debit the ScanLinkPay balance (PIN required) or pay via CinetPay. Reused
 * both on the first-time plan-selection screen (ExpensePlanSelection.tsx)
 * and as the paywall once the trial's report limit (or a paid period) runs
 * out — activating always grants 30 days of unlimited access from here.
 */
export function ExpenseProUpgrade({ status, context = 'paywall' }: ExpenseProUpgradeProps) {
  const queryClient = useQueryClient();
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const invalidateAfterActivation = () => {
    queryClient.invalidateQueries({ queryKey: ['expense-tracker-status'] });
    queryClient.invalidateQueries({ queryKey: ['expense-report-current'] });
    queryClient.invalidateQueries({ queryKey: ['wallet'] });
  };

  const walletMutation = useMutation({
    mutationFn: async (pinValue: string) => (await api.post('/expense-tracker/pro/activate', { pin: pinValue })).data,
    onSuccess: () => {
      setShowPin(false);
      setPin('');
      setError('');
      invalidateAfterActivation();
    },
    onError: (err: any) => {
      setError(err.response?.data?.message || "Échec de l'activation");
      setPin('');
    },
  });

  const cinetpayMutation = useMutation({
    mutationFn: async () => (await api.post('/expense-tracker/pro/activate/cinetpay')).data,
    onSuccess: (data) => {
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }
      // Mock provider settles synchronously.
      invalidateAfterActivation();
    },
    onError: (err: any) => setError(err.response?.data?.message || "Échec de l'activation"),
  });

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="pt-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-3">
          <Crown className="w-7 h-7 text-primary" />
        </div>
        <h2 className="text-lg font-bold text-foreground mb-1">Mode illimité</h2>
        <p className="text-sm text-muted-foreground mb-4">
          {context === 'choice'
            ? 'Enregistrez et générez vos dépenses sans aucune limite, pendant 30 jours.'
            : "Vous avez atteint la limite de dépenses de votre essai gratuit. Vos dépenses déjà clôturées restent consultables, mais il faut passer en illimité pour continuer à en générer de nouvelles."}
        </p>
        <p className="text-2xl font-bold text-foreground mb-4">
          {formatCurrency(status.monthly_price_cents, status.monthly_price_currency)} / mois
        </p>

        {error && (
          <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium mb-4 text-left">
            {error}
          </div>
        )}

        {!showPin ? (
          <div className="space-y-2">
            <Button className="w-full" onClick={() => setShowPin(true)}>
              <Wallet className="mr-2 w-4 h-4" />
              Payer depuis mon solde ScanLinkPay
            </Button>
            <Button variant="outline" className="w-full" onClick={() => cinetpayMutation.mutate()} disabled={cinetpayMutation.isPending}>
              {cinetpayMutation.isPending ? <Loader2 className="mr-2 w-4 h-4 animate-spin" /> : <CreditCard className="mr-2 w-4 h-4" />}
              Payer avec CinetPay
            </Button>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-3">
              Entrez votre code PIN pour payer {formatCurrency(status.monthly_price_cents, status.monthly_price_currency)}
            </p>
            <PinInput
              value={pin}
              onChange={(v) => {
                setPin(v);
                if (v.length === 4) walletMutation.mutate(v);
              }}
              length={4}
              autoFocus
              error={!!error}
            />
            {walletMutation.isPending && <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-3" />}
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground mt-3"
              onClick={() => { setShowPin(false); setPin(''); setError(''); }}
            >
              Annuler
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
