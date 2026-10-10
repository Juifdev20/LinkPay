import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AmountEntry } from '@/components/payment/AmountEntry';
import { PaymentMethodPicker, PaymentMethodId } from '@/components/payment/PaymentMethodPicker';
import { MobileMoneyFields } from '@/components/payment/MobileMoneyFields';
import { PaymentStep } from '@/components/payment/PaymentStep';
import { MobileMoneyWaiting } from '@/components/payment/MobileMoneyWaiting';
import { displayPhone, isNumberReady, operatorById, toApiPhone } from '@/lib/mobile-money';
import { formatCurrency } from '@/lib/utils';
import { TopupStatusCard, TopupCardStatus } from '@/components/TopupStatusCard';
import { FormSheet } from '@/components/FormSheet';
import { Loader2 } from 'lucide-react';
import { followCheckout } from '@/lib/safe-url';

type Step = 'amount' | 'method' | 'confirm' | 'processing' | 'success' | 'pending';

export default function TopupPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<Step>('amount');
  // Whole units, digits only ("25000"): the payment providers do not take cents.
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'CDF' | 'USD'>(
    searchParams.get('currency') === 'USD' ? 'USD' : 'CDF',
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodId>('mobile_money');
  const [operator, setOperator] = useState('airtel');
  // The 9 national digits of the number ("828497218"), see lib/mobile-money.
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);
  // Generated once per confirm attempt sequence (not per request) so a retry
  // after a client-side timeout reuses the same key — the backend's
  // idempotency check then returns the already-created top-up instead of
  // risking a second real charge if the first request actually succeeded
  // server-side but its response never reached this tab in time.
  const [idempotencyKey, setIdempotencyKey] = useState('');

  const { data: wallet } = useQuery({
    queryKey: ['wallet'],
    queryFn: async () => {
      const { data } = await api.get('/wallet');
      return data;
    },
  });

  const amountCents = (parseInt(amount, 10) || 0) * 100;
  const op = operatorById(operator)!;
  const balanceCents: number | undefined = wallet?.balances ? (wallet.balances[currency] ?? 0) : undefined;

  const goToMethod = () => {
    setError('');
    if (amountCents < 100) {
      setError('Saisissez un montant d\'au moins 1.');
      return;
    }
    setStep('method');
  };

  const confirmTopup = async () => {
    setError('');
    setStep('processing');
    // Stable across retries (see the comment on the state declaration) —
    // only generated once, the first time this sequence runs.
    const key = idempotencyKey || crypto.randomUUID();
    if (!idempotencyKey) setIdempotencyKey(key);
    try {
      const { data } = await api.post(
        '/wallet/topups',
        {
          amount_cents: amountCents,
          currency,
          payment_method: paymentMethod,
          mobile_money_operator: paymentMethod === 'mobile_money' ? operator : undefined,
          mobile_money_phone: paymentMethod === 'mobile_money' ? toApiPhone(phone) : undefined,
        },
        {
          headers: { 'Idempotency-Key': key },
          // The payment provider itself can take a while to answer — give
          // this request a bit more room, then fail client-side rather than
          // leaving the "Confirmez sur votre téléphone" screen spinning
          // forever (e.g. if the tab was backgrounded while the user
          // switched apps to enter their Mobile Money PIN, and the response
          // effectively got lost to this tab).
          timeout: 45000,
        },
      );

      // Real PSPs return a checkout_url and confirm later (webhook / status check) —
      // send the user there instead of claiming success early.
      if (data.checkout_url) {
        followCheckout(data.checkout_url, navigate);
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
      if (err.code === 'ECONNABORTED') {
        // The request may well have succeeded server-side — we just never
        // got the response back in time. Don't invite an uninformed retry
        // (a genuine second attempt is still safe thanks to the stable
        // idempotency key above, but confusing the user with a raw error
        // when the money may already be on its way is worse). Point them at
        // the dashboard instead; a push notification will confirm the real
        // outcome once it resolves.
        setResult(null);
        setStep('pending');
        return;
      }
      setError(err.response?.data?.message || 'Erreur lors de la recharge');
      setStep('confirm');
    }
  };

  function renderStep() {
    if (step === 'success' || step === 'pending') {
      const status: TopupCardStatus = (step === 'pending' || result?.status === 'PENDING') ? 'PENDING' : 'SUCCESS';
      const extraRows = paymentMethod === 'mobile_money'
        ? [{ label: 'Moyen de paiement', value: `${op.label} — ${displayPhone(phone)}` }]
        : [];
      return (
        <TopupStatusCard
          status={status}
          amountCents={amountCents}
          currency={currency}
          extraRows={extraRows}
          reference={result?.id}
          onBack={() => navigate('/dashboard')}
        />
      );
    }

    if (step === 'processing') {
      // The real-world Mobile Money push flow: ScanLinkPay never sees the PIN, the
      // confirmation happens entirely on the user's own phone.
      if (paymentMethod === 'mobile_money') {
        return <MobileMoneyWaiting operator={operator} phone={phone} amountCents={amountCents} currency={currency} />;
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
        <PaymentStep
          title="Vérifiez et confirmez"
          onBack={() => setStep('method')}
          error={error}
          footer={
            <div className="space-y-2">
              <Button className="h-12 w-full rounded-xl text-base font-semibold" size="lg" onClick={confirmTopup}>
                Confirmer la recharge
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                {paymentMethod === 'mobile_money' ? 'Vous validerez ensuite la demande sur votre téléphone avec votre code Mobile Money.' : 'Vous serez dirigé vers la page de paiement sécurisée.'}
              </p>
            </div>
          }
        >
          <div className="rounded-3xl bg-gradient-to-br from-primary to-[#1a3cff] px-5 py-6 text-center text-primary-foreground shadow-lg">
            <p className="text-sm opacity-80">Vous rechargez</p>
            <p className="mt-1 text-4xl font-bold tabular-nums">{formatCurrency(amountCents, currency)}</p>
          </div>

          <dl className="divide-y divide-border rounded-2xl border border-border text-sm">
            {paymentMethod === 'mobile_money' ? (
              <>
                <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                  <dt className="text-muted-foreground">Opérateur</dt>
                  <dd className="flex items-center gap-2 font-semibold text-foreground">
                    <img src={op.logo} alt="" className="h-6 w-6 rounded-md object-cover" /> {op.label}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                  <dt className="text-muted-foreground">Numéro</dt>
                  <dd className="font-semibold tabular-nums text-foreground">{displayPhone(phone)}</dd>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                <dt className="text-muted-foreground">Moyen de paiement</dt>
                <dd className="font-semibold text-foreground">Carte bancaire</dd>
              </div>
            )}
            {wallet?.wallet_number && (
              <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                <dt className="text-muted-foreground">Compte crédité</dt>
                <dd className="font-semibold text-foreground">{wallet.wallet_number}</dd>
              </div>
            )}
          </dl>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Des frais de l'opérateur peuvent s'ajouter au montant prélevé sur votre ligne. Votre compte est crédité du montant ci-dessus.
          </p>
        </PaymentStep>
      );
    }

    if (step === 'method') {
      const methodReady = paymentMethod !== 'mobile_money' || isNumberReady(operator, phone);
      return (
        <PaymentStep
          title="Moyen de paiement"
          subtitle={`Recharge de ${formatCurrency(amountCents, currency)}`}
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
          <PaymentMethodPicker value={paymentMethod} onChange={setPaymentMethod} methods={['mobile_money', 'card']} disabled={['card']} />
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

    return (
      <PaymentStep
        title="Recharger mon compte"
        subtitle={wallet?.wallet_number ? `Compte ${wallet.wallet_number}` : 'Ajoutez des fonds à votre solde ScanLinkPay'}
        error={error}
        footer={
          <Button className="h-12 w-full rounded-xl text-base font-semibold" size="lg" disabled={amountCents < 100} onClick={goToMethod}>
            Continuer
          </Button>
        }
      >
        <AmountEntry
          value={amount}
          onChange={(v) => { setError(''); setAmount(v); }}
          currency={currency}
          onCurrencyChange={setCurrency}
          balanceCents={balanceCents}
          autoFocus
        />
      </PaymentStep>
    );
  }

  return (
    <FormSheet onClose={() => navigate(-1)} title="Recharger mon compte">
      {renderStep()}
    </FormSheet>
  );
}
