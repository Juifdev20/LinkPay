import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { AmountEntry } from '@/components/payment/AmountEntry';
import { AuthField } from '@/components/auth/AuthField';
import { ResultView } from '@/components/ResultView';
import { Loader2, FileText, User, Phone, Zap, CalendarClock, Link2, ChevronDown, Check } from 'lucide-react';
import { FormSheet } from '@/components/FormSheet';
import { PaymentRequestShareCard } from '@/components/PaymentRequestShareCard';
import { cn, formatCurrency } from '@/lib/utils';

const EXPIRY_PRESETS = [
  { label: 'Paiement immédiat', hint: 'Valable 30 minutes', icon: Zap, minutes: 30 },
  { label: 'Envoyer plus tard', hint: 'Valable 24 heures', icon: CalendarClock, minutes: 1440 },
] as const;

export default function CreatePaymentRequestPage() {
  const navigate = useNavigate();
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'CDF' | 'USD'>('CDF');
  const [description, setDescription] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [expiryMinutes, setExpiryMinutes] = useState<number>(EXPIRY_PRESETS[0].minutes);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);
  const [showCustomer, setShowCustomer] = useState(false);

  const { data: merchant } = useQuery({
    queryKey: ['merchant-me'],
    queryFn: async () => (await api.get('/merchants/me')).data,
  });

  // Prefill with the shop's own default currency, but still overridable per link.
  useEffect(() => {
    if (merchant?.default_currency === 'USD') setCurrency('USD');
  }, [merchant?.default_currency]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // Whole units: the payment providers do not take cents.
      const amountCents = (Number(amount) || 0) * 100;
      if (amountCents < 100) {
        setError(`Montant minimum : 1 ${currency}`);
        setLoading(false);
        return;
      }
      const { data } = await api.post('/payment-requests', {
        amount_cents: amountCents,
        currency,
        description,
        customer_info: customerName || customerPhone ? { name: customerName, phone: customerPhone } : undefined,
        expires_in_minutes: expiryMinutes,
      });
      setResult(data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'La demande n\'a pas pu être créée. Réessayez.');
    } finally {
      setLoading(false);
    }
  };

  // Everything below renders inside the single FormSheet at the bottom of
  // this component — same result-vs-form branching JSX as before.
  function renderStep() {
    if (result) {
      return (
        <div className="mx-auto max-w-md px-5 py-6">
          <ResultView
            tone="success"
            title="Demande créée"
            amount={formatCurrency(result.amount_cents, result.currency)}
            message="Montrez le QR code à votre client ou envoyez-lui le lien."
          />
          <div className="mt-6">
            <PaymentRequestShareCard request={result} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <Button variant="outline" className="h-12 rounded-xl" onClick={() => { setResult(null); setAmount(''); setDescription(''); }}>
              Nouvelle demande
            </Button>
            <Button variant="outline" className="h-12 rounded-xl" onClick={() => navigate('/dashboard/payment-requests')}>
              Voir toutes
            </Button>
          </div>
        </div>
      );
    }

    return (
      <form onSubmit={handleSubmit} className="mx-auto max-w-md px-5 py-5">
        <p className="mb-5 text-sm text-muted-foreground">Créez un lien et un QR code : votre client paie par Mobile Money ou avec son solde ScanLinkPay.</p>
        {error && (
          <div role="alert" className="mb-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{error}</div>
        )}

        <AmountEntry value={amount} onChange={setAmount} currency={currency} onCurrencyChange={setCurrency} label="Montant demandé" autoFocus />

        <AuthField
          id="description"
          label={<>Description <span className="font-normal text-muted-foreground">(facultatif)</span></>}
          icon={FileText}
          placeholder="Ex. Facture n° 128"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          hint="Votre client la verra sur la page de paiement."
          className="mt-5"
        />

        <p className="mb-2 mt-2 text-sm font-semibold text-foreground">Validité du lien</p>
        <div role="radiogroup" aria-label="Validité du lien" className="grid grid-cols-2 gap-2.5">
          {EXPIRY_PRESETS.map((preset) => {
            const selected = expiryMinutes === preset.minutes;
            const Icon = preset.icon;
            return (
              <button
                key={preset.minutes}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setExpiryMinutes(preset.minutes)}
                className={cn(
                  'relative flex flex-col items-start gap-2 rounded-2xl border-2 p-3.5 text-left transition-colors',
                  selected ? 'border-primary bg-primary/[0.06]' : 'border-border hover:border-primary/40',
                )}
              >
                <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', selected ? 'bg-brand-gradient text-white' : 'bg-muted text-muted-foreground')}>
                  <Icon className="h-4 w-4" />
                </span>
                <span>
                  <span className={cn('block text-sm font-semibold', selected ? 'text-primary' : 'text-foreground')}>{preset.label}</span>
                  <span className="block text-xs text-muted-foreground">{preset.hint}</span>
                </span>
                {selected && (
                  <span className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setShowCustomer((v) => !v)}
          aria-expanded={showCustomer}
          className="mt-5 flex w-full items-center justify-between rounded-2xl border border-border px-4 py-3 text-sm font-semibold text-foreground hover:bg-accent/60"
        >
          <span className="flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" /> Informations du client <span className="font-normal text-muted-foreground">(facultatif)</span></span>
          <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', showCustomer && 'rotate-180')} />
        </button>
        {showCustomer && (
          <div className="mt-3">
            <AuthField id="cname" label="Nom du client" icon={User} autoComplete="off" placeholder="Ex. Jean Dupont" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            <AuthField id="cphone" label="Téléphone du client" icon={Phone} type="tel" inputMode="tel" autoComplete="off" placeholder="+243 812 345 678" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
          </div>
        )}

        <Button type="submit" className="mt-6 h-[52px] w-full rounded-xl text-base font-semibold" disabled={loading || !amount}>
          {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Link2 className="mr-2 h-5 w-5" />}
          Générer le lien
        </Button>
      </form>
    );
  }

  return (
    <FormSheet fullPage onClose={() => navigate(-1)} title="Nouvelle demande de paiement">
      {renderStep()}
    </FormSheet>
  );
}
