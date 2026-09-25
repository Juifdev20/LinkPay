import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ExpenseProUpgrade } from './ExpenseProUpgrade';
import { Loader2, Sparkles } from 'lucide-react';

interface ExpensePlanSelectionProps {
  status: { trial_report_limit?: number; monthly_price_cents: number; monthly_price_currency: 'CDF' | 'USD' };
}

/**
 * Shown once, before the tracker is reachable for the first time: pick a
 * free trial limited to a number of reports (set by super_admin), or pay
 * upfront for unlimited access straight away. Choosing "unlimited" reuses
 * the exact same payment component shown later as the post-trial paywall
 * (ExpenseProUpgrade) — activating is activating, regardless of when.
 */
export function ExpensePlanSelection({ status }: ExpensePlanSelectionProps) {
  const queryClient = useQueryClient();

  const chooseTrialMutation = useMutation({
    mutationFn: async () => (await api.post('/expense-tracker/plan/trial')).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expense-tracker-status'] }),
  });

  return (
    <div className="space-y-4">
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="pt-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-3">
            <Sparkles className="w-7 h-7 text-primary" />
          </div>
          <h2 className="text-lg font-bold text-foreground mb-1">Essai gratuit</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Générez jusqu'à <span className="font-semibold text-foreground">{status.trial_report_limit ?? 3}</span> dépenses gratuitement, sans engagement.
          </p>
          <Button className="w-full" onClick={() => chooseTrialMutation.mutate()} disabled={chooseTrialMutation.isPending}>
            {chooseTrialMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
            Commencer l'essai gratuit
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="flex-1 h-px bg-border" />
        ou
        <div className="flex-1 h-px bg-border" />
      </div>

      <ExpenseProUpgrade status={status} context="choice" />
    </div>
  );
}
