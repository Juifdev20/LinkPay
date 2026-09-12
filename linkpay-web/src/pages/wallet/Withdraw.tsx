import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { PinInput } from '@/components/PinInput';
import { CurrencySelector } from '@/components/CurrencySelector';
import { MobileMoneyOperatorPicker } from '@/components/MobileMoneyOperatorPicker';
import { MOBILE_MONEY_OPERATORS } from '@/lib/constants';
import { formatCurrency, cn } from '@/lib/utils';
import { FormSheet } from '@/components/FormSheet';
import { Loader2, Check, ArrowLeft, ArrowUpFromLine, Smartphone, Landmark } from 'lucide-react';

type Step = 'amount' | 'destination' | 'confirm' | 'pin' | 'processing' | 'success';

export default function WithdrawPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<Step>('amount');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'CDF' | 'USD'>(
    searchParams.get('currency') === 'USD' ? 'USD' : 'CDF',
  );
  const [channel, setChannel] = useState<'mobile_money' | 'bank'>('mobile_money');
  const [operator, setOperator] = useState(MOBILE_MONEY_OPERATORS[0].value);
  const [phone, setPhone] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [fee, setFee] = useState<any>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);
  const [destinationLoading, setDestinationLoading] = useState(false);

  const { data: wallet } = useQuery({
    queryKey: ['wallet'],
    queryFn: async () => (await api.get('/wallet')).data,
  });

  const amountCents = Math.round((parseFloat(amount) || 0) * 100);

  const handleAmountContinue = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!amountCents || amountCents < 1) {
      setError('Montant invalide');
      return;
    }
    setStep('destination');
  };

  const handleDestinationContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (channel === 'mobile_money' && !phone) {
      setError('Numéro Mobile Money requis');
      return;
    }
    if (channel === 'bank' && (!bankName || !accountNumber || !accountName)) {
      setError('Informations bancaires incomplètes');
      return;
    }
    setDestinationLoading(true);
    try {
      const { data } = await api.get(`/wallet/fees/WITHDRAWAL?amount_cents=${amountCents}&currency=${currency}`);
      setFee(data);
    } catch {
      setFee({ fee_cents: 0, amount_cents: amountCents, total_cents: amountCents });
    } finally {
      setDestinationLoading(false);
    }
    setStep('confirm');
  };

  const destination =
    channel === 'mobile_money' ? { operator, phone } : { bank: bankName, account_number: accountNumber, account_name: accountName };

  const handlePinComplete = async (val: string) => {
    setPin(val);
    if (val.length !== 4) return;
    setStep('processing');
    setError('');
    try {
      const { data } = await api.post(
        '/wallet/withdrawals',
        { amount_cents: amountCents, currency, channel, destination, pin: val },
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      );
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      setStep('success');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Le retrait a échoué');
      setPin('');
      setStep('pin');
    }
  };

  // Everything below renders inside the single FormSheet at the bottom of
  // this component — same step-branching JSX as before.
  function renderStep() {
    if (step === 'success') {
    const w = result?.withdrawal;
    return (
      <div className="p-6 max-w-md mx-auto">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-success" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-1">Retrait effectué !</h2>
            <p className="text-sm text-muted-foreground mb-6">
              {formatCurrency(amountCents, currency)} vers {channel === 'mobile_money' ? MOBILE_MONEY_OPERATORS.find((o) => o.value === operator)?.label : bankName}
            </p>
            <div className="rounded-xl bg-secondary p-4 text-left space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Montant</span>
                <span className="font-semibold text-foreground">{formatCurrency(amountCents, currency)}</span>
              </div>
              {fee?.fee_cents > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Frais</span>
                  <span className="text-foreground">{formatCurrency(fee.fee_cents, currency)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Statut</span>
                <span className="font-semibold text-success">{w?.status || 'SUCCESS'}</span>
              </div>
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
      <div className="p-6 max-w-md mx-auto">
        <Card>
          <CardContent className="pt-6 text-center py-16">
            <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto mb-4" />
            <p className="text-foreground font-semibold">Traitement du retrait...</p>
            <p className="text-sm text-muted-foreground mt-1">Cela peut prendre quelques instants</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'pin') {
    return (
      <div className="p-6 max-w-md mx-auto">
        <Card>
          <CardContent className="pt-6 text-center">
            <button onClick={() => setStep('confirm')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 float-left">
              <ArrowLeft className="w-4 h-4" /> Retour
            </button>
            {error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium mb-4 mt-8 clear-left">
                {error}
              </div>
            )}
            <h2 className="text-lg font-bold text-foreground mb-1 mt-10 clear-left">Code PIN</h2>
            <p className="text-sm text-muted-foreground mb-6">Confirmez le retrait de {formatCurrency(amountCents, currency)}</p>
            <PinInput value={pin} onChange={handlePinComplete} length={4} autoFocus />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'confirm') {
    return (
      <div className="p-6 max-w-md mx-auto">
        <Card>
          <CardContent className="pt-6">
            <button onClick={() => setStep('destination')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
              <ArrowLeft className="w-4 h-4" /> Modifier
            </button>
            {error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium mb-4">
                {error}
              </div>
            )}
            <div className="rounded-xl bg-secondary p-4 space-y-2 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Destination</span>
                <span className="font-semibold text-foreground text-right">
                  {channel === 'mobile_money' ? `${MOBILE_MONEY_OPERATORS.find((o) => o.value === operator)?.label} — ${phone}` : `${bankName} — ${accountNumber}`}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Montant</span>
                <span className="font-semibold text-foreground">{formatCurrency(amountCents, currency)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Frais</span>
                <span className="text-foreground">{fee?.fee_cents ? formatCurrency(fee.fee_cents, currency) : 'Aucun'}</span>
              </div>
              <div className="flex justify-between text-sm font-bold pt-2 border-t border-border">
                <span className="text-foreground">Total débité</span>
                <span className="text-foreground">{formatCurrency(fee?.total_cents ?? amountCents, currency)}</span>
              </div>
            </div>
            <Button className="w-full" size="lg" onClick={() => setStep('pin')}>Continuer</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'destination') {
    return (
      <div className="p-6 max-w-md mx-auto">
        <Card>
          <CardContent className="pt-6">
            <button onClick={() => setStep('amount')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
              <ArrowLeft className="w-4 h-4" /> Modifier le montant
            </button>
            <form onSubmit={handleDestinationContinue} className="space-y-4">
              {error && (
                <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label className="font-semibold">Moyen de retrait</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => setChannel('mobile_money')} className={cn('flex flex-col items-center gap-1.5 rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-colors', channel === 'mobile_money' ? 'border-primary bg-primary/5 text-primary' : 'border-input text-muted-foreground hover:bg-accent')}>
                    <Smartphone className="w-5 h-5" /> Mobile Money
                  </button>
                  <button type="button" onClick={() => setChannel('bank')} className={cn('flex flex-col items-center gap-1.5 rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-colors', channel === 'bank' ? 'border-primary bg-primary/5 text-primary' : 'border-input text-muted-foreground hover:bg-accent')}>
                    <Landmark className="w-5 h-5" /> Compte bancaire
                  </button>
                </div>
              </div>

              {channel === 'mobile_money' ? (
                <>
                  <MobileMoneyOperatorPicker value={operator} onChange={setOperator} />
                  <div className="space-y-2">
                    <Label htmlFor="phone" className="font-semibold">Numéro Mobile Money</Label>
                    <Input id="phone" placeholder="+243 8XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="bank" className="font-semibold">Banque</Label>
                    <Input id="bank" placeholder="Equity BCDC" value={bankName} onChange={(e) => setBankName(e.target.value)} autoFocus />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="accnum" className="font-semibold">Numéro de compte</Label>
                    <Input id="accnum" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="accname" className="font-semibold">Titulaire du compte</Label>
                    <Input id="accname" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
                  </div>
                </>
              )}
              <Button type="submit" className="w-full" size="lg" disabled={destinationLoading}>
                {destinationLoading && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                Continuer
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-md mx-auto">
      <Card>
        <CardContent className="pt-6">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <ArrowUpFromLine className="w-7 h-7 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-1 text-center">Retirer de l'argent</h2>
          <p className="text-sm text-muted-foreground mb-6 text-center">
            {wallet ? `Solde disponible : ${formatCurrency(wallet.balances?.[currency] || 0, currency)}` : 'Vers Mobile Money ou compte bancaire'}
          </p>
          <form onSubmit={handleAmountContinue} className="space-y-4">
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
              <Input id="amount" type="number" step="0.01" placeholder="50000" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
            </div>
            <Button type="submit" className="w-full" size="lg">Continuer</Button>
          </form>
        </CardContent>
      </Card>
    </div>
    );
  }

  return (
    <FormSheet onClose={() => navigate(-1)} title="Retirer de l'argent">
      {renderStep()}
    </FormSheet>
  );
}
