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
import { MobileMoneyFields } from '@/components/payment/MobileMoneyFields';
import { MOBILE_MONEY_OPERATORS, displayPhone, isNumberReady, operatorById, toApiPhone } from '@/lib/mobile-money';
import { ACCOUNT_DIGITS, BANK_DELAY_HOURS, accountDigits, formatAccountInput, isAccountComplete, isHolderName } from '@/lib/banks';
import { useAuthStore } from '@/lib/auth-store';
import { Select } from '@/components/ui/select';
import { formatCurrency, cn } from '@/lib/utils';
import { FormSheet } from '@/components/FormSheet';
import { Loader2, Check, Clock, ArrowLeft, Smartphone, Landmark, ChevronRight } from 'lucide-react';

type Step = 'point' | 'amount' | 'destination' | 'confirm' | 'pin' | 'processing' | 'success';

export default function WithdrawPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<Step>('point');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'CDF' | 'USD'>(
    searchParams.get('currency') === 'USD' ? 'USD' : 'CDF',
  );
  const [channel, setChannel] = useState<'mobile_money' | 'bank'>('mobile_money');
  const [operator, setOperator] = useState('airtel');
  // The 9 national digits of the Mobile Money number ("828497218"), see lib/mobile-money.
  const [phone, setPhone] = useState('');
  // Bank: picked ONLY in the list the super admin switched on (never typed), the account number written XXXXX-XXXXX-XXXXXXXXXXX-XX and typed twice.
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountConfirm, setAccountConfirm] = useState('');
  // The account title: the name registered AT THE BANK. Offered with the name of the ScanLinkPay account, which the person corrects if the bank has it otherwise.
  const ownName = useAuthStore((s) => s.user?.full_name) ?? '';
  const [accountName, setAccountName] = useState(ownName);
  const { data: bankList } = useQuery<{ banks: string[] }>({
    queryKey: ['platform-banks'],
    queryFn: async () => (await api.get('/platform/banks')).data,
    staleTime: 60_000,
  });
  const banks = bankList?.banks ?? [];
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
    if (channel === 'mobile_money' && !isNumberReady(operator, phone)) {
      setError('Numéro Mobile Money incomplet ou ne correspondant pas à l\'opérateur choisi.');
      return;
    }
    if (channel === 'bank') {
      if (!bankName) return setError('Choisissez votre banque.');
      if (!isAccountComplete(accountNumber)) return setError(`Le numéro de compte doit comporter ${ACCOUNT_DIGITS} chiffres (exemple : 00017-00001-12345678901-23). Vous le trouvez sur votre relevé ou dans l'application de votre banque.`);
      if (accountDigits(accountConfirm) !== accountDigits(accountNumber)) return setError('Les deux numéros de compte ne sont pas identiques. Vérifiez-les.');
      if (!isHolderName(accountName)) return setError('Saisissez l\'intitulé du compte, tel qu\'il apparaît à la banque.');
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
    channel === 'mobile_money' ? { operator, phone: toApiPhone(phone) } : { bank: bankName, account_number: accountNumber, account_name: accountName };

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
    // Only the payment provider can confirm that the money was sent; until
    // it does the withdrawal is "in progress", never "done".
    const done = w?.status === 'SUCCESS';
    // No payout API at the provider: our team sends the money, so the request is only "registered".
    const manual = !!result?.manual;
    return (
      <div className="p-6 max-w-md mx-auto">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className={cn('w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4', done ? 'bg-success/10' : 'bg-warning/10')}>
              {done ? <Check className="w-8 h-8 text-success" /> : <Clock className="w-8 h-8 text-warning" />}
            </div>
            <h2 className="text-xl font-bold text-foreground mb-1">{done ? 'Retrait effectué !' : manual ? 'Demande enregistrée' : 'Retrait en cours'}</h2>
            <p className="text-sm text-muted-foreground mb-6">
              {formatCurrency(amountCents, currency)} vers {channel === 'mobile_money' ? operatorById(operator)?.label : bankName}
              {!done && <><br />{manual ? `Notre équipe va envoyer l'argent${channel === 'bank' ? ` sous ${result?.expected_hours ?? BANK_DELAY_HOURS} h` : ''}. Vous serez notifié dès que c'est fait.` : 'Vous serez notifié dès que l\'argent est envoyé.'}</>}
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
                <span className={cn('font-semibold', done ? 'text-success' : 'text-warning')}>{done ? 'Effectué' : manual ? 'En attente de traitement' : 'En cours'}</span>
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
            <PinInput value={pin} onChange={handlePinComplete} length={4} autoFocus title="Confirmer le retrait" hint={`Retrait de ${formatCurrency(amountCents, currency)}`} message={error} />
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
                  {channel === 'mobile_money' ? `${operatorById(operator)?.label} — ${displayPhone(phone)}` : `${bankName} — ${accountNumber}`}
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
                <MobileMoneyFields
                  operator={operator}
                  onOperatorChange={setOperator}
                  phone={phone}
                  onPhoneChange={setPhone}
                  autoFocusPhone
                  hint="L'argent sera envoyé sur ce numéro Mobile Money."
                />
              ) : (
                <>
                  <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-3 text-sm text-foreground">
                    <p className="font-semibold">Virement bancaire</p>
                    <p className="text-muted-foreground">Notre équipe envoie le virement sous {BANK_DELAY_HOURS} h. Vous êtes averti dès que c'est fait. Si la banque refuse le compte, votre argent vous est rendu en entier, frais compris.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bank" className="font-semibold">Banque</Label>
                    <Select id="bank" value={bankName} onChange={(e) => setBankName(e.target.value)} autoFocus>
                      <option value="">{banks.length ? 'Choisissez votre banque' : 'Chargement des banques…'}</option>
                      {banks.map((b) => <option key={b} value={b}>{b}</option>)}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="accnum" className="font-semibold">Numéro de compte (RIB)</Label>
                    <Input id="accnum" inputMode="numeric" autoComplete="off" placeholder="00017-00001-12345678901-23" value={accountNumber} onChange={(e) => setAccountNumber(formatAccountInput(e.target.value))} />
                    <p className="text-xs text-muted-foreground">{ACCOUNT_DIGITS} chiffres : code banque, code agence, numéro de compte et clé. Vous les trouvez sur votre relevé ou dans l'application de votre banque.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="accnum2" className="font-semibold">Confirmez le numéro de compte</Label>
                    <Input id="accnum2" inputMode="numeric" autoComplete="off" placeholder="Saisissez-le encore une fois" value={accountConfirm} onChange={(e) => setAccountConfirm(formatAccountInput(e.target.value))} />
                    {accountConfirm && accountDigits(accountConfirm) === accountDigits(accountNumber) && isAccountComplete(accountNumber) && <p className="text-xs text-success font-medium">Les deux numéros sont identiques.</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="accname" className="font-semibold">Intitulé du compte (nom à la banque)</Label>
                    <Input id="accname" value={accountName} onChange={(e) => setAccountName(e.target.value)} maxLength={100} />
                    <p className="text-xs text-muted-foreground">Le nom enregistré à la banque, pas celui de ScanLinkPay : corrigez-le s'il est différent. Un compte au nom d'une autre personne peut retarder le traitement.</p>
                  </div>
                </>
              )}
              <Button type="submit" className="w-full" size="lg" disabled={destinationLoading || (channel === 'mobile_money' && !isNumberReady(operator, phone))}>
                {destinationLoading && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                Continuer
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Where the money goes, chosen first (as in the design): one Mobile Money network or a bank.
  const chosenPoint = channel === 'bank'
    ? { label: 'Agence bancaire', logo: null as string | null }
    : { label: operatorById(operator)?.label ?? 'Mobile Money', logo: operatorById(operator)?.logo ?? null };

  if (step === 'point') {
    const points = [
      ...MOBILE_MONEY_OPERATORS.map((o) => ({ key: o.id, label: o.label, logo: o.logo as string | null, pick: () => { setChannel('mobile_money'); setOperator(o.id); } })),
      { key: 'bank', label: 'Agence bancaire', logo: null as string | null, pick: () => setChannel('bank') },
    ];
    return (
      <div className="px-5 pt-2 pb-6 max-w-md mx-auto space-y-4">
        <div>
          <p className="font-semibold text-foreground">Choisir un point de retrait</p>
          {wallet && <p className="text-xs text-muted-foreground mt-0.5">Solde disponible : {formatCurrency(wallet.balances?.[currency] || 0, currency)}</p>}
        </div>
        <div className="rounded-2xl border border-border bg-card shadow-soft divide-y divide-border overflow-hidden">
          {points.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => { p.pick(); setError(''); setStep('amount'); }}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent active:bg-accent"
            >
              {p.logo ? (
                <img src={p.logo} alt="" className="h-9 w-9 rounded-xl object-cover" />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Landmark className="h-5 w-5" /></span>
              )}
              <span className="flex-1 text-sm font-semibold text-foreground">{p.label}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleAmountContinue} className="px-5 pt-2 pb-6 max-w-md mx-auto space-y-5">
      <button type="button" onClick={() => setStep('point')} className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left shadow-soft">
        {chosenPoint.logo ? (
          <img src={chosenPoint.logo} alt="" className="h-10 w-10 rounded-xl object-cover" />
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">{channel === 'bank' ? <Landmark className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-muted-foreground">Point de retrait</span>
          <span className="block truncate font-semibold text-foreground">{chosenPoint.label}</span>
        </span>
        <span className="text-xs font-semibold text-primary">Changer</span>
      </button>
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
        <Label htmlFor="amount" className="font-semibold">Montant</Label>
        <div className="flex h-14 items-center rounded-2xl border border-border bg-card px-4 shadow-soft focus-within:ring-2 focus-within:ring-ring">
          <input id="amount" type="number" inputMode="decimal" step="0.01" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus className="min-w-0 flex-1 bg-transparent text-2xl font-bold text-foreground outline-none placeholder:text-muted-foreground/50" />
          <span className="text-sm font-semibold text-muted-foreground">{currency}</span>
        </div>
        {wallet && <p className="text-xs text-muted-foreground">Solde disponible : {formatCurrency(wallet.balances?.[currency] || 0, currency)}</p>}
      </div>
      <Button type="submit" className="w-full h-12 rounded-2xl text-base">
        Continuer
        <ChevronRight className="ml-1 h-4 w-4" />
      </Button>
    </form>
    );
  }

  return (
    <FormSheet fullPage onClose={() => navigate(-1)} title="Retrait d'argent">
      {renderStep()}
    </FormSheet>
  );
}
