import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Clock, Loader2, ShieldCheck, TimerReset } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormSheet } from '@/components/FormSheet';
import { PaymentStep } from '@/components/payment/PaymentStep';
import { AmountEntry } from '@/components/payment/AmountEntry';
import { PinInput } from '@/components/PinInput';
import { ResultCard, ResultView } from '@/components/ResultView';
import { useExchangeState } from '@/hooks/useExchangeState';
import { amountToCents, centsToAmount } from '@/lib/amount';
import { givenToReceive, otherCurrency, rateLine, receivedCents, type Currency, type ExchangeQuote } from '@/lib/exchange';
import { cn, formatCurrency, formatDate } from '@/lib/utils';

type Step = 'amount' | 'confirm' | 'pin' | 'processing' | 'success';

const CURRENCY_NAME: Record<Currency, string> = { CDF: 'Franc congolais', USD: 'Dollar américain' };
const QUICK: Record<Currency, number[]> = { USD: [25, 50, 100, 250], CDF: [10000, 50000, 100000, 250000] };

const messageOf = (err: any, fallback: string): string => err?.response?.data?.message || fallback;
const codeOf = (err: any): string | undefined => err?.response?.data?.code;

/** « Je donne » / « Je reçois »: one of the two currencies, as a small box. */
function CurrencyBox({ label, currency }: { label: string; currency: Currency }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-card px-3.5 py-2.5">
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      <p className="mt-0.5 flex items-center gap-2 text-base font-bold text-foreground">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-gradient text-[10px] font-bold text-primary-foreground">
          {currency === 'USD' ? '$' : 'F'}
        </span>
        {currency}
      </p>
      <p className="truncate text-[11px] text-muted-foreground">{CURRENCY_NAME[currency]}</p>
    </div>
  );
}

/** The account is not validated yet (or no longer): say why, and hold the button that asks for it, ready. */
function VerificationNeeded({ status, reason, onDone }: { status: string; reason: string | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const send = useMutation({
    mutationFn: async () => (await api.post('/exchange/verification')).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exchange'] }),
    onError: (err: any) => setError(messageOf(err, "La demande n'a pas pu être envoyée. Réessayez.")),
  });

  if (status === 'pending') {
    return (
      <PaymentStep title="Demande envoyée" footer={<Button className="h-12 w-full rounded-xl text-base font-semibold" size="lg" onClick={onDone}>Compris</Button>}>
        <ResultView
          tone="waiting"
          title="En attente de validation"
          message="Notre équipe va examiner votre demande. Vous serez prévenu par notification dès que votre compte est validé."
        />
      </PaymentStep>
    );
  }

  return (
    <PaymentStep
      title="Validation de votre compte requise"
      error={error}
      footer={
        <div className="space-y-2">
          <Button className="h-12 w-full rounded-xl text-base font-semibold" size="lg" disabled={send.isPending} onClick={() => { setError(''); send.mutate(); }}>
            {send.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Envoyer ma demande de validation'}
          </Button>
          <Button variant="ghost" className="h-11 w-full rounded-xl text-sm font-semibold text-muted-foreground" onClick={onDone}>Plus tard</Button>
        </div>
      }
    >
      <div className="flex flex-col items-center text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ShieldCheck className="h-8 w-8" />
        </span>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
          {status === 'rejected' && reason
            ? `Votre dernière demande n'a pas été acceptée : ${reason}.`
            : status === 'revoked'
            ? "L'accès au Bureau d'échange a été retiré à votre compte."
            : "Pour utiliser le Bureau d'échange, notre équipe doit d'abord valider votre compte."}
          {' '}Votre nom et votre numéro sont envoyés avec la demande, et nous vous contactons pour vérifier votre identité.
        </p>
      </div>
    </PaymentStep>
  );
}

export default function ExchangePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { data: state, isLoading, isError, refetch } = useExchangeState();
  const { data: wallet } = useQuery({ queryKey: ['wallet'], queryFn: async () => (await api.get('/wallet')).data });

  const [from, setFrom] = useState<Currency>(searchParams.get('from') === 'CDF' ? 'CDF' : 'USD');
  const to = otherCurrency(from);
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<Step>('amount');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<ExchangeQuote | null>(null);
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [pin, setPin] = useState('');
  const [result, setResult] = useState<any>(null);
  // One key per quote: a retry after a cut connection finds the exchange already made instead of making a second.
  const keyRef = useRef('');

  const rates = state?.rates ?? null;
  const limit = state?.limits?.[from];
  const balance: number = wallet?.balances ? (wallet.balances[from] ?? 0) : 0;
  const cents = amountToCents(amount);
  const preview = rates && cents > 0 ? receivedCents(from, cents, rates) : null;

  // Arriving from « solde insuffisant » (?from=USD&need=68000): fill in how much to give to receive what is missing.
  const prefilled = useRef(false);
  useEffect(() => {
    const need = Number(searchParams.get('need'));
    if (prefilled.current || !rates || !(need > 0)) return;
    prefilled.current = true;
    const give = givenToReceive(from, need * 100, rates);
    setAmount(centsToAmount(give));
  }, [rates, searchParams, from]);

  // The countdown of the guaranteed rate.
  useEffect(() => {
    if (step !== 'confirm' && step !== 'pin') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);
  const secondsLeft = Math.max(0, Math.ceil((deadline - now) / 1000));
  const expired = !!quote && secondsLeft === 0;

  if (isLoading) {
    return (
      <FormSheet fullPage onClose={() => navigate(-1)} title="Bureau d'échange">
        <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      </FormSheet>
    );
  }
  // No button for these accounts nor while the service is off: a direct address leads home.
  if (!isError && state && !(state.eligible && state.enabled)) return <Navigate to="/dashboard" replace />;
  if (isError || !state) {
    return (
      <FormSheet fullPage onClose={() => navigate(-1)} title="Bureau d'échange">
        <PaymentStep title="Service injoignable" footer={<Button className="h-12 w-full rounded-xl text-base font-semibold" size="lg" onClick={() => refetch()}>Réessayer</Button>}>
          <p className="text-sm text-muted-foreground">Le Bureau d'échange est injoignable pour le moment. Vérifiez votre connexion, puis réessayez.</p>
        </PaymentStep>
      </FormSheet>
    );
  }

  const verification = state.verification;
  if (state.paused) {
    return (
      <FormSheet fullPage onClose={() => navigate(-1)} title="Bureau d'échange">
        <PaymentStep title="Service en pause" footer={<Button className="h-12 w-full rounded-xl text-base font-semibold" size="lg" onClick={() => navigate(-1)}>Compris</Button>}>
          <ResultView
            tone="waiting"
            title="Momentanément en pause"
            message="Les taux du jour ne sont pas encore à jour. Le Bureau d'échange rouvre dès qu'ils le sont : réessayez un peu plus tard."
          />
        </PaymentStep>
      </FormSheet>
    );
  }
  if (verification?.status !== 'approved') {
    return (
      <FormSheet fullPage onClose={() => navigate(-1)} title="Bureau d'échange">
        <VerificationNeeded status={verification?.status ?? 'none'} reason={verification?.reason ?? null} onDone={() => navigate(-1)} />
      </FormSheet>
    );
  }

  // ---- what the person typed, checked as they type (the server checks again)
  const remainingDay = limit?.daily_max_cents != null ? Math.max(0, limit.daily_max_cents - limit.used_today_cents) : null;
  const remainingMonth = limit?.monthly_max_cents != null ? Math.max(0, limit.monthly_max_cents - limit.used_month_cents) : null;
  let fieldError = '';
  if (cents > 0) {
    if (cents > balance) fieldError = `Solde insuffisant : vous avez ${formatCurrency(balance, from)}.`;
    else if (limit?.min_cents && cents < limit.min_cents) fieldError = `Montant minimum : ${formatCurrency(limit.min_cents, from)}.`;
    else if (limit?.max_cents != null && cents > limit.max_cents) fieldError = `Montant maximum par échange : ${formatCurrency(limit.max_cents, from)}.`;
    else if (remainingDay != null && cents > remainingDay) fieldError = `Il vous reste ${formatCurrency(remainingDay, from)} d'échange aujourd'hui.`;
    else if (remainingMonth != null && cents > remainingMonth) fieldError = `Il vous reste ${formatCurrency(remainingMonth, from)} d'échange ce mois-ci.`;
    else if (preview && preview.to_cents < 1) fieldError = 'Ce montant est trop petit pour être échangé.';
  }
  const canContinue = cents > 0 && !fieldError && !!preview && preview.to_cents > 0;

  const swap = () => {
    setError('');
    setAmount('');
    setFrom(to);
  };

  async function askQuote(): Promise<ExchangeQuote | null> {
    try {
      const { data } = await api.post<ExchangeQuote>('/exchange/quotes', { from_currency: from, to_currency: to, amount_cents: cents }, { timeout: 20000 });
      keyRef.current = crypto.randomUUID();
      setQuote(data);
      setDeadline(Date.now() + data.seconds * 1000);
      setNow(Date.now());
      return data;
    } catch (err: any) {
      queryClient.invalidateQueries({ queryKey: ['exchange'] });
      setError(messageOf(err, "Impossible d'obtenir le taux. Réessayez."));
      return null;
    }
  }

  const goConfirm = async () => {
    setError('');
    setNotice('');
    setBusy(true);
    const q = await askQuote();
    setBusy(false);
    if (q) setStep('confirm');
  };

  /** The guaranteed rate ran out: ask a new one, and say plainly if the price moved. */
  const refreshQuote = async (reason?: string) => {
    const before = quote?.rate;
    setError('');
    setBusy(true);
    const q = await askQuote();
    setBusy(false);
    setStep(q ? 'confirm' : 'amount');
    if (q) setNotice(before != null && before !== q.rate ? `Le taux a changé : ${rateLine(q.rate)} (avant : ${rateLine(before)}). Vérifiez avant de confirmer.` : reason || '');
  };

  const handlePin = async (val: string) => {
    setPin(val);
    if (val.length !== 4 || !quote) return;
    setStep('processing');
    setError('');
    const attempt = () => api.post('/exchange', { quote_id: quote.quote_id, pin: val }, { headers: { 'Idempotency-Key': keyRef.current }, timeout: 30000 });
    try {
      let response;
      try {
        response = await attempt();
      } catch (err: any) {
        // No answer at all: the exchange may have been made. Asking again with the SAME key either returns it or makes it, never twice.
        if (err.response) throw err;
        await new Promise((r) => setTimeout(r, 1500));
        response = await attempt();
      }
      setResult(response.data);
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['exchange'] });
      setStep('success');
    } catch (err: any) {
      const code = codeOf(err);
      setPin('');
      if (code === 'EXCHANGE_QUOTE_EXPIRED') {
        await refreshQuote('Le taux garanti avait expiré : voici le taux actuel.');
        return;
      }
      if (!err.response) {
        setError("Connexion perdue. Avant de réessayer, regardez votre historique : l'échange a peut-être été effectué.");
        setStep('confirm');
        return;
      }
      if (code) {
        // The service closed, the account lost its access, a limit was reached, the balance went down…
        queryClient.invalidateQueries({ queryKey: ['exchange'] });
        queryClient.invalidateQueries({ queryKey: ['wallet'] });
        setError(messageOf(err, "L'échange a échoué."));
        setStep('amount');
        return;
      }
      // A wrong PIN: ask again, with the reason on the code screen.
      setError(messageOf(err, "L'échange a échoué."));
      setStep('pin');
    }
  };

  // ------------------------------------------------------------------ steps
  const wrap = (content: React.ReactNode) => (
    <FormSheet fullPage onClose={() => navigate(-1)} title="Bureau d'échange">{content}</FormSheet>
  );

  if (step === 'success' && result?.exchange) {
    const ex = result.exchange;
    const b = result.balances || {};
    return wrap(
      <ResultCard>
        <ResultView
          tone="success"
          title="Échange réussi"
          amount={formatCurrency(ex.to_cents, ex.to_currency)}
          message={`${formatCurrency(ex.from_cents, ex.from_currency)} → ${formatCurrency(ex.to_cents, ex.to_currency)}`}
          rows={[
            { label: 'Référence', value: ex.reference, copy: ex.reference },
            { label: 'Date', value: formatDate(ex.created_at) },
            { label: 'Taux appliqué', value: rateLine(ex.rate) },
            { label: 'Solde en dollars', value: formatCurrency(b.USD ?? 0, 'USD') },
            { label: 'Solde en francs', value: formatCurrency(b.CDF ?? 0, 'CDF') },
          ]}
        >
          <Button className="h-[52px] w-full rounded-xl text-base font-semibold" onClick={() => navigate('/dashboard')}>Retour à l'accueil</Button>
          <Button variant="outline" className="h-[52px] w-full rounded-xl text-base font-semibold" onClick={() => navigate('/dashboard/wallet/transactions')}>Voir mes transactions</Button>
        </ResultView>
      </ResultCard>,
    );
  }

  if (step === 'processing') {
    return wrap(
      <div className="p-6 max-w-md mx-auto">
        <Card>
          <CardContent className="py-16 pt-6 text-center">
            <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-primary" />
            <p className="font-semibold text-foreground">Échange en cours…</p>
            <p className="mt-1 text-sm text-muted-foreground">Cela ne prend que quelques instants.</p>
          </CardContent>
        </Card>
      </div>,
    );
  }

  if (step === 'pin' && quote) {
    return wrap(
      <PaymentStep title="Code PIN" subtitle={`Confirmez l'échange de ${formatCurrency(quote.from_cents, quote.from_currency)}`} onBack={() => { setPin(''); setError(''); setStep('confirm'); }}>
        <div className="flex justify-center py-6">
          <PinInput
            value={pin}
            onChange={handlePin}
            length={4}
            autoFocus
            title="Confirmer l'échange"
            hint={`${formatCurrency(quote.from_cents, quote.from_currency)} → ${formatCurrency(quote.to_cents, quote.to_currency)}`}
            message={error}
            onCancel={() => { setPin(''); setError(''); setStep('confirm'); }}
          />
        </div>
      </PaymentStep>,
    );
  }

  if (step === 'confirm' && quote) {
    return wrap(
      <PaymentStep
        title="Confirmer l'échange"
        onBack={() => { setError(''); setNotice(''); setStep('amount'); }}
        error={error}
        footer={
          expired ? (
            <Button className="h-12 w-full rounded-xl text-base font-semibold" size="lg" disabled={busy} onClick={() => refreshQuote()}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <><TimerReset className="mr-2 h-5 w-5" /> Actualiser le taux</>}
            </Button>
          ) : (
            <Button className="h-12 w-full rounded-xl text-base font-semibold" size="lg" onClick={() => { setError(''); setPin(''); setStep('pin'); }}>
              Confirmer l'échange
            </Button>
          )
        }
      >
        <div className="rounded-3xl bg-gradient-to-br from-primary to-[#1a3cff] px-5 py-6 text-center text-primary-foreground shadow-lg">
          <p className="text-sm opacity-80">Vous donnez</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{formatCurrency(quote.from_cents, quote.from_currency)}</p>
          <ArrowLeftRight className="mx-auto my-3 h-5 w-5 rotate-90 opacity-80" />
          <p className="text-sm opacity-80">Vous recevez</p>
          <p className="mt-1 text-4xl font-bold tabular-nums">{formatCurrency(quote.to_cents, quote.to_currency)}</p>
        </div>

        {notice && (
          <div role="status" className="rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-3 text-sm font-medium text-foreground">{notice}</div>
        )}

        <dl className="divide-y divide-border rounded-2xl border border-border text-sm">
          <div className="flex items-center justify-between gap-3 px-4 py-3.5">
            <dt className="text-muted-foreground">Taux appliqué</dt>
            <dd className="font-semibold tabular-nums text-foreground">{rateLine(quote.rate)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3.5">
            <dt className="text-muted-foreground">Taux garanti</dt>
            <dd>
              {expired ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-bold text-destructive"><Clock className="h-3.5 w-3.5" /> Expiré</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-bold tabular-nums text-success">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" /> {String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:{String(secondsLeft % 60).padStart(2, '0')}
                </span>
              )}
            </dd>
          </div>
          {wallet?.wallet_number && (
            <div className="flex items-center justify-between gap-3 px-4 py-3.5">
              <dt className="text-muted-foreground">Compte</dt>
              <dd className="font-semibold text-foreground">{wallet.wallet_number}</dd>
            </div>
          )}
        </dl>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Le taux est garanti pendant {quote.seconds} secondes. S'il expire avant votre confirmation, un nouveau taux vous est proposé, que vous revoyez avant de confirmer.
        </p>
      </PaymentStep>,
    );
  }

  // ---- amount
  return wrap(
    <PaymentStep
      title="Changer de devise"
      subtitle={wallet?.wallet_number ? `Compte ${wallet.wallet_number}` : 'Changez vos francs et vos dollars'}
      error={error}
      footer={
        <Button className="h-12 w-full rounded-xl text-base font-semibold" size="lg" disabled={!canContinue || busy} onClick={goConfirm}>
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Continuer'}
        </Button>
      }
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <CurrencyBox label="Je donne" currency={from} />
        <button
          type="button"
          onClick={swap}
          aria-label="Inverser les devises"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-brand transition-transform active:scale-90"
        >
          <ArrowLeftRight className="h-[18px] w-[18px]" />
        </button>
        <CurrencyBox label="Je reçois" currency={to} />
      </div>

      <AmountEntry
        value={amount}
        onChange={(v) => { setError(''); setAmount(v); }}
        currency={from}
        hideCurrencySwitch
        allowDecimals={from === 'USD'}
        presets={QUICK[from]}
        label="Montant à échanger"
        balanceCents={balance}
        afterLabel={null}
        onMax={() => setAmount(centsToAmount(from === 'CDF' ? Math.floor(balance / 100) * 100 : balance))}
        error={fieldError}
        autoFocus
      />

      <div className="rounded-2xl bg-secondary/60 px-4 py-4">
        <p className="text-xs font-semibold text-muted-foreground">Vous recevrez</p>
        <p className={cn('mt-1 text-3xl font-bold tabular-nums', preview ? 'text-primary' : 'text-muted-foreground/40')}>
          {formatCurrency(preview?.to_cents ?? 0, to)}
        </p>
        <dl className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
          {rates && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Taux du jour</dt>
              <dd className="font-semibold tabular-nums text-foreground">{rateLine(from === 'USD' ? rates.buy : rates.sell)}</dd>
            </div>
          )}
          {remainingDay != null && limit?.daily_max_cents != null && (
            <div className="flex justify-between gap-3">
              <dt className="whitespace-nowrap text-muted-foreground">Reste aujourd'hui</dt>
              <dd className="text-right font-semibold tabular-nums text-foreground">
                {formatCurrency(remainingDay, from)}
                <span className="block text-xs font-normal text-muted-foreground">sur {formatCurrency(limit.daily_max_cents, from)}</span>
              </dd>
            </div>
          )}
          {limit?.min_cents ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Minimum</dt>
              <dd className="font-semibold tabular-nums text-foreground">{formatCurrency(limit.min_cents, from)}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </PaymentStep>,
  );
}

