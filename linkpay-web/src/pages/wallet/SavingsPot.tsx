import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PinInput } from '@/components/PinInput';
import { PageHeader } from '@/components/PageHeader';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import { Loader2, ArrowLeft, PiggyBank, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';

const INCREMENTS = [
  { label: '100 CDF', cents: 10000 },
  { label: '500 CDF', cents: 50000 },
  { label: '1 000 CDF', cents: 100000 },
];

export default function SavingsPotPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['savings'],
    queryFn: async () => (await api.get('/savings')).data,
  });

  const [enabled, setEnabled] = useState(false);
  const [increment, setIncrement] = useState(50000);
  const [goalName, setGoalName] = useState('');
  const [goalAmount, setGoalAmount] = useState('');
  const [settingsError, setSettingsError] = useState('');

  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState('');
  const [withdrawError, setWithdrawError] = useState('');

  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (data?.pot && !seeded) {
      setEnabled(!!data.pot.round_up_enabled);
      setIncrement(data.pot.round_up_increment_cents ?? 50000);
      setGoalName(data.pot.goal_name || '');
      setGoalAmount(data.pot.goal_amount_cents ? String(data.pot.goal_amount_cents / 100) : '');
      setSeeded(true);
    }
  }, [data, seeded]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, any> = {
        round_up_enabled: enabled,
        round_up_increment_cents: increment,
        goal_name: goalName || undefined,
      };
      if (goalAmount) payload.goal_amount_cents = Math.round(parseFloat(goalAmount) * 100);
      return (await api.put('/savings/settings', payload)).data;
    },
    onSuccess: () => {
      setSettingsError('');
      queryClient.invalidateQueries({ queryKey: ['savings'] });
    },
    onError: (err: any) => setSettingsError(err.response?.data?.message || "Échec de l'enregistrement"),
  });

  const withdrawMutation = useMutation({
    mutationFn: async (pinValue: string) => (await api.post('/savings/withdraw', { amount_cents: Math.round(parseFloat(withdrawAmount) * 100), pin: pinValue })).data,
    onSuccess: () => {
      setShowWithdraw(false);
      setShowPin(false);
      setWithdrawAmount('');
      setPin('');
      setWithdrawError('');
      queryClient.invalidateQueries({ queryKey: ['savings'] });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
    onError: (err: any) => {
      setWithdrawError(err.response?.data?.message || 'Le retrait a échoué');
      setPin('');
    },
  });

  if (isLoading || !data) {
    return (
      <div className="p-6 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const balance = data.balance_cents || 0;
  const goalAmountCents = data.pot?.goal_amount_cents;
  const progress = goalAmountCents ? Math.min(100, Math.round((balance / goalAmountCents) * 100)) : null;

  return (
    <div className="p-6 pb-28 md:pb-6 space-y-6 max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Retour
      </button>

      <PageHeader title="Épargne par arrondi" />

      <Card>
        <CardContent className="pt-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <PiggyBank className="w-7 h-7 text-primary" />
          </div>
          <p className="text-sm text-muted-foreground mb-1">Solde de la tirelire</p>
          <p className="text-3xl font-bold text-foreground mb-4">{formatCurrency(balance, 'CDF')}</p>

          {data.pot?.goal_name && (
            <div className="mb-4">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>{data.pot.goal_name}</span>
                <span>{progress}%{goalAmountCents ? ` · ${formatCurrency(goalAmountCents, 'CDF')}` : ''}</span>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress || 0}%` }} />
              </div>
            </div>
          )}

          {!showWithdraw && (
            <Button variant="outline" className="w-full" onClick={() => setShowWithdraw(true)} disabled={balance <= 0}>
              <ArrowUpFromLine className="mr-2 w-4 h-4" />
              Retirer vers mon solde principal
            </Button>
          )}

          {showWithdraw && !showPin && (
            <div className="space-y-3 text-left">
              {withdrawError && <p className="text-sm text-destructive">{withdrawError}</p>}
              <div className="space-y-2">
                <Label htmlFor="withdraw_amount" className="font-semibold text-sm">Montant à retirer (CDF)</Label>
                <Input
                  id="withdraw_amount"
                  type="number"
                  step="0.01"
                  placeholder="5000"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowWithdraw(false)}>Annuler</Button>
                <Button
                  className="flex-1"
                  disabled={!withdrawAmount || parseFloat(withdrawAmount) <= 0}
                  onClick={() => setShowPin(true)}
                >
                  Continuer
                </Button>
              </div>
            </div>
          )}

          {showPin && (
            <div className="text-center">
              {withdrawError && <p className="text-sm text-destructive mb-3">{withdrawError}</p>}
              <p className="text-sm text-muted-foreground mb-3">Entrez votre code PIN pour retirer {formatCurrency(Math.round(parseFloat(withdrawAmount) * 100), 'CDF')}</p>
              <PinInput
                value={pin}
                onChange={(v) => {
                  setPin(v);
                  if (v.length === 4) withdrawMutation.mutate(v);
                }}
                length={4}
                autoFocus
              />
              {withdrawMutation.isPending && <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-3" />}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Réglages</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {settingsError && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">
              {settingsError}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-sm text-foreground">Activer l'épargne par arrondi</p>
              <p className="text-xs text-muted-foreground">À chaque paiement en CDF, le montant est arrondi et la différence part dans votre tirelire.</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {enabled && (
            <div className="space-y-2">
              <Label className="font-semibold text-sm">Arrondir au multiple de</Label>
              <div className="grid grid-cols-3 gap-2">
                {INCREMENTS.map((i) => (
                  <button
                    key={i.cents}
                    type="button"
                    onClick={() => setIncrement(i.cents)}
                    className={cn(
                      'rounded-xl border-2 px-2 py-2.5 text-xs font-semibold transition-colors',
                      increment === i.cents ? 'border-primary bg-primary/5 text-primary' : 'border-input text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {i.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-border space-y-3">
            <Label htmlFor="goal_name" className="font-semibold text-sm">Objectif (optionnel)</Label>
            <Input id="goal_name" placeholder="Ex: Vélo" value={goalName} onChange={(e) => setGoalName(e.target.value)} />
            <Input
              id="goal_amount"
              type="number"
              step="0.01"
              placeholder="Montant cible (CDF)"
              value={goalAmount}
              onChange={(e) => setGoalAmount(e.target.value)}
            />
          </div>

          <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
            Enregistrer
          </Button>
        </CardContent>
      </Card>

      {data.entries?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Historique</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.entries.map((e: any) => (
                <div key={e.id} className="flex items-center justify-between py-1.5 text-sm">
                  <div className="flex items-center gap-2">
                    {e.type === 'round_up' ? (
                      <ArrowDownToLine className="w-4 h-4 text-success" />
                    ) : (
                      <ArrowUpFromLine className="w-4 h-4 text-muted-foreground" />
                    )}
                    <span className="text-foreground">{e.type === 'round_up' ? 'Arrondi épargné' : 'Retrait'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span className={cn('font-semibold', e.type === 'round_up' ? 'text-success' : 'text-foreground')}>
                      {e.type === 'round_up' ? '+' : '-'}{formatCurrency(e.amount_cents, 'CDF')}
                    </span>
                    <span>{formatDate(e.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
