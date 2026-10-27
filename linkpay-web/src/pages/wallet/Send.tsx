import { useState, useEffect, useRef } from 'react';
import { announcePaymentError } from '@/lib/sound';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { PinInput } from '@/components/PinInput';
import { formatCurrency } from '@/lib/utils';
import { FormSheet } from '@/components/FormSheet';
import { PaymentMethodPicker, PaymentMethodId } from '@/components/payment/PaymentMethodPicker';
import { MobileMoneyFields } from '@/components/payment/MobileMoneyFields';
import { MobileMoneyWaiting } from '@/components/payment/MobileMoneyWaiting';
import { PaymentStep } from '@/components/payment/PaymentStep';
import { TopupStatusCard } from '@/components/TopupStatusCard';
import { usePaymentStatusPoll } from '@/hooks/usePaymentStatusPoll';
import { displayPhone, isNumberReady, operatorById, toApiPhone } from '@/lib/mobile-money';
import { followCheckout } from '@/lib/safe-url';
import { Loader2, Check, Search, ArrowLeft, User, Store, UserRound, QrCode, ChevronRight } from 'lucide-react';
import { UserAvatar } from '@/components/UserAvatar';
import { indicativeOther, useIndicativeRate } from '@/lib/indicative-rate';

type Step = 'number' | 'amount' | 'method' | 'confirm' | 'pin' | 'processing' | 'waiting' | 'success' | 'failed' | 'pending';

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
  const [amountLoading, setAmountLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const autoLookedUp = useRef(false);
  // How the send is funded: the wallet balance (PIN to confirm) or the
  // provider (Mobile Money prompt / card page — no PIN, money comes in).
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodId>('wallet');
  const [operator, setOperator] = useState('airtel');
  // The 9 national digits of the number ("828497218"), see lib/mobile-money.
  const [phone, setPhone] = useState('');
  const [transferRef, setTransferRef] = useState('');
  // Stable across retries of the same sequence — same reason as Topup.tsx:
  // a timed-out request may still have created the transfer server-side.
  const [idempotencyKey, setIdempotencyKey] = useState('');

  const { data: wallet } = useQuery({
    queryKey: ['wallet'],
    queryFn: async () => (await api.get('/wallet')).data,
  });

  // Which funding methods are open (the bank card is switched on by the platform once tested).
  const { data: methods } = useQuery<{ mobile_money: boolean; card: boolean }>({
    queryKey: ['wallet-payment-methods'],
    queryFn: async () => (await api.get('/wallet/payment-methods')).data,
  });
  const cardOpen = !!methods?.card;

  const amountCents = Math.round((parseFloat(amount) || 0) * 100);
  const rate = useIndicativeRate();

  // While the Mobile Money confirmation is pending, poll the transfer's
  // status — the same fallback the top-up flow uses for a missing webhook.
  const { data: polled, timedOut: pollTimedOut } = usePaymentStatusPoll<{ transfer: { status: string } }>(
    ['transfer-status', transferRef],
    async () => (await api.get(`/wallet/transfers/${encodeURIComponent(transferRef)}/status`)).data,
    (d) => d.transfer.status,
    step === 'waiting' && !!transferRef,
  );

  useEffect(() => {
    const s = polled?.transfer?.status;
    if (step !== 'waiting' || !s) return;
    if (s === 'SUCCESS') {
      setResult({ transfer: polled.transfer });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-transactions'] });
      setStep('success');
    } else if (s === 'FAILED') {
      setStep('failed');
    } else if (pollTimedOut) {
      setStep('pending');
    }
  }, [polled, pollTimedOut, step, queryClient]);

  const lookup = async (number: string) => {
    setError('');
    setLooking(true);
    try {
      const { data } = await api.get(`/wallet/lookup/${encodeURIComponent(number.trim())}`);
      // A store's wallet doesn't take transfers (the API refuses them too):
      // a sale has to go through an invoice so it is recorded and charged.
      if (data.accepts_transfers === false) {
        setError(`${data.display_name} est un compte marchand : il ne reçoit pas de transferts. Pour le payer, demandez-lui une facture (scannez son QR de paiement ou saisissez sa référence via « Payer »).`);
        return;
      }
      setRecipient(data);
      setStep('amount');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Numéro ScanLinkPay introuvable');
    } finally {
      setLooking(false);
    }
  };

  // Arriving from the QR scanner (?to=) — skip retyping the number, search
  // immediately, same pattern as Pay.tsx's ?ref= auto-lookup.
  useEffect(() => {
    const to = searchParams.get('to');
    if (to && !autoLookedUp.current) {
      autoLookedUp.current = true;
      setRecipientNumber(to);
      lookup(to);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    lookup(recipientNumber);
  };

  const handleAmountContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!amountCents || amountCents < 1) {
      setError('Montant invalide');
      return;
    }
    setAmountLoading(true);
    try {
      const { data } = await api.get(`/wallet/fees/TRANSFER?amount_cents=${amountCents}&currency=${currency}`);
      setFee(data);
      setStep('method');
    } catch {
      setFee({ fee_cents: 0, amount_cents: amountCents, total_cents: amountCents });
      setStep('method');
    } finally {
      setAmountLoading(false);
    }
  };

  // PSP-funded send: the provider charges the sender's Mobile Money line (or
  // card) amount + fee; the recipient is credited once the provider confirms.
  const handleFundedSubmit = async () => {
    setError('');
    setStep('processing');
    const key = idempotencyKey || crypto.randomUUID();
    if (!idempotencyKey) setIdempotencyKey(key);
    try {
      const { data } = await api.post(
        '/wallet/transfers',
        {
          recipient_wallet_number: recipient.wallet_number,
          amount_cents: amountCents,
          currency,
          description,
          payment_method: paymentMethod,
          mobile_money_operator: paymentMethod === 'mobile_money' ? operator : undefined,
          mobile_money_phone: paymentMethod === 'mobile_money' ? toApiPhone(phone) : undefined,
        },
        { headers: { 'Idempotency-Key': key }, timeout: 45000 },
      );
      setTransferRef(data.reference || '');
      if (data.checkout_url) {
        followCheckout(data.checkout_url, navigate);
        return;
      }
      if (data.transfer?.status === 'SUCCESS') {
        setResult(data);
        queryClient.invalidateQueries({ queryKey: ['wallet'] });
        setStep('success');
        return;
      }
      // PENDING — wait for the sender to confirm on their own phone.
      setStep('waiting');
    } catch (err: any) {
      if (err.code === 'ECONNABORTED') {
        // The transfer may well exist server-side — the user is told it is
        // still running rather than invited into a blind retry (the stable
        // idempotency key makes a real retry safe anyway).
        setStep('pending');
        return;
      }
      const message = err.response?.data?.message || 'Le transfert a échoué';
      announcePaymentError(message);
      setError(message);
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
      const message = err.response?.data?.message || 'Le transfert a échoué';
      announcePaymentError(message);
      setError(message);
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
              {formatCurrency(amountCents, currency)} envoyés à {recipient?.display_name}
            </p>
            <div className="rounded-xl bg-secondary p-4 text-left space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Destinataire</span>
                <span className="font-semibold text-foreground">{recipient?.display_name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Numéro ScanLinkPay</span>
                <span className="font-mono text-foreground">{recipient?.wallet_number}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Montant</span>
                <span className="font-semibold text-foreground">{formatCurrency(amountCents, currency)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Moyen</span>
                <span className="text-foreground">
                  {paymentMethod === 'wallet' ? 'Solde ScanLinkPay' : paymentMethod === 'mobile_money' ? 'Mobile Money' : 'Carte bancaire'}
                </span>
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
            {result?.roundup && (
              <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-3 mt-4 text-sm text-primary font-medium">
                🐷 Vous avez aussi épargné {formatCurrency(result.roundup.amount_cents, result.roundup.currency)} — tirelire : {formatCurrency(result.roundup.pot_balance_cents, result.roundup.currency)}
              </div>
            )}
            <Button className="w-full mt-6" size="lg" onClick={() => navigate('/dashboard')}>
              Retour au tableau de bord
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'failed' || step === 'pending') {
    const extraRows = [
      { label: 'Destinataire', value: recipient?.display_name ?? '—' },
      ...(paymentMethod === 'mobile_money' ? [{ label: 'Moyen de paiement', value: `${operatorById(operator)!.label} — ${displayPhone(phone)}` }] : []),
      ...(paymentMethod === 'card' ? [{ label: 'Moyen de paiement', value: 'Carte bancaire' }] : []),
    ];
    return (
      <TopupStatusCard
        kind="transfer"
        status={step === 'failed' ? 'FAILED' : 'PENDING'}
        amountCents={amountCents}
        currency={currency}
        extraRows={extraRows}
        reference={transferRef}
        onBack={() => navigate('/dashboard')}
      />
    );
  }

  if (step === 'waiting') {
    // The Mobile Money push is on the sender's phone — the poll above turns
    // the provider's confirmation into success/failed/pending.
    return <MobileMoneyWaiting operator={operator} phone={phone} amountCents={fee?.total_cents ?? amountCents} currency={currency} />;
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
            <PinInput value={pin} onChange={handlePinComplete} length={4} autoFocus title="Confirmer l'envoi" hint={`Envoi de ${formatCurrency(amountCents, currency)} à ${recipient?.display_name}`} message={error} />
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
            <button onClick={() => setStep('method')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
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
                <span className="text-muted-foreground">Moyen de paiement</span>
                <span className="font-semibold text-foreground">
                  {paymentMethod === 'wallet' ? 'Solde ScanLinkPay' : paymentMethod === 'mobile_money' ? `${operatorById(operator)!.label} — ${displayPhone(phone)}` : 'Carte bancaire'}
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
                <span className="text-foreground">Total à payer</span>
                <span className="text-foreground">{formatCurrency(fee?.total_cents ?? amountCents, currency)}</span>
              </div>
            </div>
            <Button className="w-full" size="lg" onClick={() => (paymentMethod === 'wallet' ? setStep('pin') : handleFundedSubmit())}>
              Continuer
            </Button>
            {paymentMethod !== 'wallet' && (
              <p className="text-center text-xs text-muted-foreground mt-3">
                {paymentMethod === 'mobile_money'
                  ? 'Vous validerez ensuite la demande sur votre téléphone avec votre code Mobile Money.'
                  : 'Vous saisirez les informations de votre carte sur la page sécurisée de notre partenaire de paiement.'}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'method') {
    const methodReady = paymentMethod !== 'mobile_money' || isNumberReady(operator, phone);
    return (
      <PaymentStep
        title="Moyen de paiement"
        subtitle={`${formatCurrency(amountCents, currency)} pour ${recipient?.display_name}`}
        onBack={() => { setError(''); setStep('amount'); }}
        error={error}
        footer={
          <Button
            className="h-12 w-full rounded-xl text-base font-semibold"
            size="lg"
            disabled={!methodReady}
            onClick={() => { setError(''); setStep('confirm'); }}
          >
            Continuer
          </Button>
        }
      >
        <PaymentMethodPicker
          value={paymentMethod}
          onChange={setPaymentMethod}
          methods={['wallet', 'mobile_money', 'card']}
          disabled={cardOpen ? [] : ['card']}
          walletNote={wallet ? `Solde disponible : ${formatCurrency(wallet.balances?.[currency] || 0, currency)}` : undefined}
        />
        {paymentMethod === 'mobile_money' && (
          <MobileMoneyFields
            operator={operator}
            onOperatorChange={setOperator}
            phone={phone}
            onPhoneChange={setPhone}
            autoFocusPhone
            hint="Une demande de paiement sera envoyée à ce numéro, que vous validerez avec votre code Mobile Money."
          />
        )}
      </PaymentStep>
    );
  }

  if (step === 'amount') {
    const presets = currency === 'CDF' ? [5000, 10000, 20000, 50000] : [5, 10, 20, 50];
    const approx = indicativeOther(amountCents, currency, rate);
    return (
      <form onSubmit={handleAmountContinue} className="px-5 pt-2 pb-6 max-w-md mx-auto space-y-5">
        {error && (
          <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">
            {error}
          </div>
        )}
        <div className="space-y-2">
          <Label className="font-semibold">Bénéficiaire</Label>
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-soft">
            {recipient?.is_merchant ? (
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary"><Store className="h-5 w-5" /></span>
            ) : (
              <UserAvatar className="h-10 w-10" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-foreground">{recipient?.display_name}</p>
              <p className="text-xs text-muted-foreground font-mono">{recipient?.wallet_number}</p>
            </div>
            <button type="button" onClick={() => setStep('number')} aria-label="Changer de bénéficiaire" className="flex h-9 w-9 items-center justify-center rounded-full text-primary hover:bg-primary/10">
              <UserRound className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="amount" className="font-semibold">Montant</Label>
          <div className="flex h-14 items-center rounded-2xl border border-border bg-card px-4 shadow-soft focus-within:ring-2 focus-within:ring-ring">
            <input
              id="amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-2xl font-bold text-foreground outline-none placeholder:text-muted-foreground/50"
            />
            <button
              type="button"
              onClick={() => setCurrency(currency === 'CDF' ? 'USD' : 'CDF')}
              className="rounded-lg px-2 py-1 text-sm font-semibold text-muted-foreground hover:bg-accent"
              aria-label="Changer de devise"
            >
              {currency}
            </button>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{approx || ' '}</span>
            {wallet && <span>Solde : {formatCurrency(wallet.balances?.[currency] || 0, currency)}</span>}
          </div>
          <div className="grid grid-cols-4 gap-2 pt-1">
            {presets.map((p) => {
              const active = amountCents === p * 100;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAmount(String(p))}
                  className={`rounded-full border py-2 text-xs font-semibold transition-colors ${active ? 'border-transparent bg-brand-gradient text-white shadow-brand' : 'border-border bg-card text-foreground hover:bg-accent'}`}
                >
                  {new Intl.NumberFormat('fr-FR').format(p)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="description" className="font-semibold">Motif (optionnel)</Label>
          <Input id="description" placeholder="Ex. : Aide, Frais, etc." value={description} onChange={(e) => setDescription(e.target.value)} className="rounded-2xl bg-card" />
        </div>

        <Button type="submit" className="w-full h-12 rounded-2xl text-base" disabled={amountLoading}>
          {amountLoading && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
          Continuer
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleLookup} className="px-5 pt-2 pb-6 max-w-md mx-auto space-y-5">
      {error && (
        <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">
          {error}
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="number" className="font-semibold">Bénéficiaire</Label>
        <div className="flex h-14 items-center gap-2 rounded-2xl border border-border bg-card px-4 shadow-soft focus-within:ring-2 focus-within:ring-ring">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            id="number"
            placeholder="Numéro ScanLinkPay (SLP-…)"
            value={recipientNumber}
            onChange={(e) => setRecipientNumber(e.target.value)}
            required
            autoFocus
            className="min-w-0 flex-1 bg-transparent font-mono text-sm text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground"
          />
          <button type="button" onClick={() => navigate('/dashboard/wallet/scan')} aria-label="Scanner un QR" className="flex h-9 w-9 items-center justify-center rounded-full text-primary hover:bg-primary/10">
            <QrCode className="h-5 w-5" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">Saisissez le numéro ScanLinkPay du bénéficiaire, ou scannez son QR.</p>
      </div>
      <Button type="submit" className="w-full h-12 rounded-2xl text-base" disabled={looking || !recipientNumber}>
        {looking && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
        Continuer
        <ChevronRight className="ml-1 h-4 w-4" />
      </Button>
    </form>
    );
  }

  return (
    <FormSheet fullPage onClose={() => navigate(-1)} title="Envoyer de l'argent">
      {renderStep()}
    </FormSheet>
  );
}
