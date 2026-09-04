import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/lib/utils';
import { Loader2, Check, DollarSign, ArrowLeft, Wallet as WalletIcon } from 'lucide-react';

const PRESETS = [5000, 10000, 25000, 50000];

type Step = 'amount' | 'confirm' | 'processing' | 'success';

export default function TopupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);

  const { data: wallet } = useQuery({
    queryKey: ['wallet'],
    queryFn: async () => {
      const { data } = await api.get('/wallet');
      return data;
    },
  });

  const amountCents = Math.round((parseFloat(amount) || 0) * 100);

  const goToConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!amountCents || amountCents < 100) {
      setError('Montant minimum : 1 CDF');
      return;
    }
    setStep('confirm');
  };

  const confirmTopup = async () => {
    setError('');
    setStep('processing');
    try {
      const { data } = await api.post(
        '/wallet/topups',
        { amount_cents: amountCents },
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      );

      // Real PSPs (e.g. CinetPay) return a checkout_url and confirm later via
      // webhook — send the user there instead of claiming success early.
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }

      // Mock provider (and an idempotent replay) settle synchronously.
      setResult(data.topup);
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-transactions'] });
      setStep('success');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur lors de la recharge');
      setStep('confirm');
    }
  };

  if (step === 'success') {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-success" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-1">Recharge réussie !</h2>
            <p className="text-sm text-muted-foreground mb-6">
              {formatCurrency(amountCents)} ajouté(s) à votre compte LinkPay
            </p>
            <div className="rounded-xl bg-secondary p-4 text-left space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Montant</span>
                <span className="font-semibold text-foreground">{formatCurrency(amountCents)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Statut</span>
                <span className="font-semibold text-success">{result?.status || 'Confirmé'}</span>
              </div>
              {result?.id && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Référence</span>
                  <span className="font-mono text-xs text-foreground truncate ml-2">{result.id}</span>
                </div>
              )}
            </div>
            <Button className="w-full mt-6" size="lg" onClick={() => navigate('/dashboard')}>
              Retour au tableau de bord
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'processing') {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <Card>
          <CardContent className="pt-6 text-center py-16">
            <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto mb-4" />
            <p className="text-foreground font-semibold">Traitement de la recharge...</p>
            <p className="text-sm text-muted-foreground mt-1">Merci de patienter quelques instants</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'confirm') {
    return (
      <div className="p-6 max-w-lg mx-auto">
        <Card>
          <CardContent className="pt-6">
            <button
              onClick={() => setStep('amount')}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
            >
              <ArrowLeft className="w-4 h-4" /> Modifier
            </button>
            {error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium mb-4">
                {error}
              </div>
            )}
            <div className="text-center mb-6">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <WalletIcon className="w-7 h-7 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">Confirmer la recharge de</p>
              <p className="text-3xl font-bold text-foreground mt-1">{formatCurrency(amountCents)}</p>
              {wallet?.wallet_number && (
                <p className="text-xs text-muted-foreground mt-1">vers {wallet.wallet_number}</p>
              )}
            </div>
            <Button className="w-full" size="lg" onClick={confirmTopup}>
              Confirmer
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-lg mx-auto">
      <Card>
        <CardContent className="pt-6">
          <h2 className="text-xl font-bold text-foreground mb-1">Recharger mon compte</h2>
          <p className="text-sm text-muted-foreground mb-6">
            {wallet?.wallet_number ? `Compte ${wallet.wallet_number}` : 'Ajoutez des fonds à votre solde LinkPay'}
          </p>
          <form onSubmit={goToConfirm} className="space-y-4">
            {error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="amount" className="font-semibold">Montant (CDF)</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  placeholder="10000"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  autoFocus
                  className="pl-10"
                />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAmount(String(p))}
                  className="rounded-xl border border-border py-2 text-xs font-semibold text-foreground hover:border-primary/50 hover:bg-primary/5 transition-colors"
                >
                  {p.toLocaleString('fr-FR')}
                </button>
              ))}
            </div>
            <Button type="submit" className="w-full" size="lg">
              Continuer
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
