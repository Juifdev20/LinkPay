import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { CurrencySelector } from '@/components/CurrencySelector';
import { PaymentMethodSelector } from '@/components/PaymentMethodSelector';
import { MobileMoneyOperatorPicker } from '@/components/MobileMoneyOperatorPicker';
import { MOBILE_MONEY_OPERATORS } from '@/lib/constants';
import { formatCurrency } from '@/lib/utils';
import { Loader2, Check, DollarSign, ArrowLeft, Wallet as WalletIcon, Smartphone, Phone } from 'lucide-react';

const PRESETS = [5000, 10000, 25000, 50000];

type Step = 'amount' | 'method' | 'confirm' | 'processing' | 'success' | 'pending';

export default function TopupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'CDF' | 'USD'>(
    searchParams.get('currency') === 'USD' ? 'USD' : 'CDF',
  );
  const [paymentMethod, setPaymentMethod] = useState<'mobile_money' | 'card'>('mobile_money');
  const [operator, setOperator] = useState('airtel');
  const [phone, setPhone] = useState('');
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

  const goToMethod = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!amountCents || amountCents < 100) {
      setError('Montant minimum : 1');
      return;
    }
    setStep('method');
  };

  const confirmTopup = async () => {
    setError('');
    setStep('processing');
    try {
      const { data } = await api.post(
        '/wallet/topups',
        {
          amount_cents: amountCents,
          currency,
          payment_method: paymentMethod,
          mobile_money_operator: paymentMethod === 'mobile_money' ? operator : undefined,
          mobile_money_phone: paymentMethod === 'mobile_money' ? phone : undefined,
        },
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
      if (data.topup?.status === 'PENDING') {
        setStep('pending');
      } else {
        queryClient.invalidateQueries({ queryKey: ['wallet'] });
        queryClient.invalidateQueries({ queryKey: ['wallet-transactions'] });
        setStep('success');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur lors de la recharge');
      setStep('confirm');
    }
  };

  if (step === 'success' || step === 'pending') {
    const isPending = step === 'pending' || result?.status === 'PENDING';
    return (
      <div className="p-6 max-w-lg mx-auto">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${isPending ? 'bg-warning/10' : 'bg-success/10'}`}>
              {isPending ? (
                <Loader2 className="w-8 h-8 text-warning animate-spin" />
              ) : (
                <Check className="w-8 h-8 text-success" />
              )}
            </div>
            <h2 className="text-xl font-bold text-foreground mb-1">
              {isPending ? 'En attente de confirmation' : 'Recharge réussie !'}
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              {isPending
                ? `Votre recharge de ${formatCurrency(amountCents, currency)} est en cours de traitement. Le solde sera mis à jour après confirmation.`
                : `${formatCurrency(amountCents, currency)} ajouté(s) à votre compte LinkPay`}
            </p>
            <div className="rounded-xl bg-secondary p-4 text-left space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Montant</span>
                <span className="font-semibold text-foreground">{formatCurrency(amountCents, currency)}</span>
              </div>
              {paymentMethod === 'mobile_money' && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Moyen de paiement</span>
                  <span className="font-semibold text-foreground">{MOBILE_MONEY_OPERATORS.find((o) => o.value === operator)?.label} — {phone}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Statut</span>
                <span className={`font-semibold ${isPending ? 'text-warning' : 'text-success'}`}>
                  {isPending ? 'En attente' : 'Confirmé'}
                </span>
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
    // Mirrors the same real-world Mobile Money STK/USSD push flow shown to
    // payers on the public payment page: LinkPay never sees the PIN, the
    // confirmation happens entirely on the user's own phone.
    if (paymentMethod === 'mobile_money') {
      const operatorLabel = MOBILE_MONEY_OPERATORS.find((o) => o.value === operator)?.label;
      return (
        <div className="p-6 max-w-lg mx-auto">
          <Card>
            <CardContent className="pt-6 text-center py-10">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Smartphone className="w-8 h-8 text-primary animate-pulse" />
              </div>
              <h2 className="text-lg font-bold text-foreground mb-2">Confirmez sur votre téléphone</h2>
              <p className="text-muted-foreground text-sm mb-1">
                Une demande {operatorLabel} a été envoyée au {phone}.
              </p>
              <p className="text-muted-foreground text-sm mb-6">
                Ouvrez l'application et entrez votre code PIN Mobile Money pour confirmer le retrait de{' '}
                {formatCurrency(amountCents, currency)}.
              </p>
              <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
            </CardContent>
          </Card>
        </div>
      );
    }
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
              onClick={() => setStep('method')}
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
              <p className="text-3xl font-bold text-foreground mt-1">{formatCurrency(amountCents, currency)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {paymentMethod === 'mobile_money'
                  ? `via ${MOBILE_MONEY_OPERATORS.find((o) => o.value === operator)?.label} — ${phone}`
                  : 'via carte bancaire'}
              </p>
              {wallet?.wallet_number && (
                <p className="text-xs text-muted-foreground">vers {wallet.wallet_number}</p>
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

  if (step === 'method') {
    const canContinue = paymentMethod !== 'mobile_money' || phone.trim().length >= 9;
    return (
      <div className="p-6 max-w-lg mx-auto">
        <Card>
          <CardContent className="pt-6">
            <button
              onClick={() => setStep('amount')}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
            >
              <ArrowLeft className="w-4 h-4" /> Modifier le montant
            </button>
            {error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium mb-4">
                {error}
              </div>
            )}
            <p className="text-sm text-muted-foreground mb-4">
              Recharger de {formatCurrency(amountCents, currency)}
            </p>
            <div className="space-y-4">
              <PaymentMethodSelector value={paymentMethod} onChange={setPaymentMethod} />
              {paymentMethod === 'mobile_money' && (
                <>
                  <MobileMoneyOperatorPicker value={operator} onChange={setOperator} />
                  <div className="space-y-2">
                    <Label htmlFor="mm_phone" className="font-semibold">
                      Numéro {MOBILE_MONEY_OPERATORS.find((o) => o.value === operator)?.label}
                    </Label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        id="mm_phone"
                        placeholder="+243 8XX XXX XXX"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="pl-10"
                        autoFocus
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Une demande de paiement sera envoyée à ce numéro pour confirmer le retrait.
                    </p>
                  </div>
                </>
              )}
              <Button
                className="w-full"
                size="lg"
                disabled={!canContinue}
                onClick={() => {
                  setError('');
                  if (!canContinue) {
                    setError('Numéro Mobile Money requis');
                    return;
                  }
                  setStep('confirm');
                }}
              >
                Continuer
              </Button>
            </div>
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
          <form onSubmit={goToMethod} className="space-y-4">
            {error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label className="font-semibold">Devise</Label>
              <CurrencySelector value={currency} onChange={setCurrency} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount" className="font-semibold">Montant ({currency})</Label>
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
