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
import { formatCurrency } from '@/lib/utils';
import { FormSheet } from '@/components/FormSheet';
import { Loader2, Check, Search, ArrowLeft, Send as SendIcon, User, Store } from 'lucide-react';

type Step = 'number' | 'amount' | 'confirm' | 'pin' | 'processing' | 'success';

export default function SendPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<Step>('number');
  const [recipientNumber, setRecipientNumber] = useState('');
  const [recipient, setRecipient] = useState<any>(null);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'CDF' | 'USD'>(
    searchParams.get('currency') === 'USD' ? 'USD' : 'CDF',
  );
  const [description, setDescription] = useState('');
  const [fee, setFee] = useState<any>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [looking, setLooking] = useState(false);
  const [result, setResult] = useState<any>(null);

  const { data: wallet } = useQuery({
    queryKey: ['wallet'],
    queryFn: async () => (await api.get('/wallet')).data,
  });

  const amountCents = Math.round((parseFloat(amount) || 0) * 100);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLooking(true);
    try {
      const { data } = await api.get(`/wallet/lookup/${encodeURIComponent(recipientNumber.trim())}`);
      setRecipient(data);
      setStep('amount');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Numéro LinkPay introuvable');
    } finally {
      setLooking(false);
    }
  };

  const handleAmountContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!amountCents || amountCents < 1) {
      setError('Montant invalide');
      return;
    }
    try {
      const { data } = await api.get(`/wallet/fees/TRANSFER?amount_cents=${amountCents}&currency=${currency}`);
      setFee(data);
      setStep('confirm');
    } catch {
      setFee({ fee_cents: 0, amount_cents: amountCents, total_cents: amountCents });
      setStep('confirm');
    }
  };

  const handlePinComplete = async (val: string) => {
    setPin(val);
    if (val.length !== 4) return;
    setStep('processing');
    setError('');
    try {
      const { data } = await api.post(
        '/wallet/transfers',
        { recipient_wallet_number: recipient.wallet_number, amount_cents: amountCents, currency, description, pin: val },
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      );
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      setStep('success');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Le transfert a échoué');
      setPin('');
      setStep('pin');
    }
  };

  // Everything below renders inside the single FormSheet at the bottom of
  // this component — same step-branching JSX as before, just no longer
  // each wrapped in its own top-level page div.
  function renderStep() {
    if (step === 'success') {
    return (
      <div className="p-6 max-w-md mx-auto">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-success" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-1">Transfert envoyé !</h2>
            <p className="text-sm text-muted-foreground mb-6">
              {formatCurrency(amountCents, currency)} envoyé(s) à {recipient?.display_name}
            </p>
            <div className="rounded-xl bg-secondary p-4 text-left space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Destinataire</span>
                <span className="font-semibold text-foreground">{recipient?.display_name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Numéro LinkPay</span>
                <span className="font-mono text-foreground">{recipient?.wallet_number}</span>
              </div>
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
                <span className="font-semibold text-success">{result?.transfer?.status || 'SUCCESS'}</span>
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
            <p className="text-foreground font-semibold">Envoi en cours...</p>
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
            <p className="text-sm text-muted-foreground mb-6">
              Confirmez l'envoi de {formatCurrency(amountCents, currency)} à {recipient?.display_name}
            </p>
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
            <button onClick={() => setStep('amount')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
              <ArrowLeft className="w-4 h-4" /> Modifier
            </button>
            {error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium mb-4">
                {error}
              </div>
            )}
            <div className="text-center mb-6">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                {recipient?.is_merchant ? <Store className="w-7 h-7 text-primary" /> : <User className="w-7 h-7 text-primary" />}
              </div>
              <p className="font-bold text-foreground text-lg">{recipient?.display_name}</p>
              <p className="text-xs text-muted-foreground font-mono">{recipient?.wallet_number}</p>
            </div>
            <div className="rounded-xl bg-secondary p-4 space-y-2 mb-6">
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
            <Button className="w-full" size="lg" onClick={() => setStep('pin')}>
              Continuer
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'amount') {
    return (
      <div className="p-6 max-w-md mx-auto">
        <Card>
          <CardContent className="pt-6">
            <button onClick={() => setStep('number')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
              <ArrowLeft className="w-4 h-4" /> Modifier le destinataire
            </button>
            <div className="flex items-center gap-3 rounded-xl bg-secondary p-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                {recipient?.is_merchant ? <Store className="w-5 h-5 text-primary" /> : <User className="w-5 h-5 text-primary" />}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-foreground truncate">{recipient?.display_name}</p>
                <p className="text-xs text-muted-foreground font-mono">{recipient?.wallet_number}</p>
              </div>
            </div>
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
                <Input id="amount" type="number" step="0.01" placeholder="10000" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus />
                {wallet && <p className="text-xs text-muted-foreground">Solde disponible : {formatCurrency(wallet.balances?.[currency] || 0, currency)}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="description" className="font-semibold">Note (optionnel)</Label>
                <Input id="description" placeholder="Pour le loyer..." value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" size="lg">Continuer</Button>
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
            <SendIcon className="w-7 h-7 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-1 text-center">Envoyer de l'argent</h2>
          <p className="text-sm text-muted-foreground mb-6 text-center">Entrez le numéro LinkPay du destinataire</p>
          <form onSubmit={handleLookup} className="space-y-4">
            {error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="number" className="font-semibold">Numéro LinkPay</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="number"
                  placeholder="LP-00001234"
                  value={recipientNumber}
                  onChange={(e) => setRecipientNumber(e.target.value)}
                  required
                  autoFocus
                  className="pl-10 font-mono"
                />
              </div>
            </div>
            <Button type="submit" className="w-full" size="lg" disabled={looking || !recipientNumber}>
              {looking && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
              Rechercher
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
    );
  }

  return (
    <FormSheet onClose={() => navigate(-1)} title="Envoyer de l'argent">
      {renderStep()}
    </FormSheet>
  );
}
