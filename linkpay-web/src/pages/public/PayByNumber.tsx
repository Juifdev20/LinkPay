import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { PublicShell, PublicCard } from '@/components/public/PublicShell';
import { ResultView } from '@/components/ResultView';
import { AmountEntry } from '@/components/payment/AmountEntry';
import { cn } from '@/lib/utils';
import { Loader2, AlertCircle, Building2, Store, ArrowRight, Check, SearchX } from 'lucide-react';

interface OrgLookup {
  id: string;
  name: string;
  legal_name?: string;
  scanlinkpay_number: string;
  merchants: { id: string; name: string; logo_url?: string }[];
}

export default function PayByNumber() {
  const { number } = useParams<{ number: string }>();
  const navigate = useNavigate();
  const [org, setOrg] = useState<OrgLookup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'CDF' | 'USD'>('CDF');
  const [merchantId, setMerchantId] = useState('');
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    api.get(`/organizations/pay/${encodeURIComponent(number ?? "")}`)
      .then(({ data }) => {
        setOrg(data);
        if (data.merchants.length === 1) setMerchantId(data.merchants[0].id);
      })
      .catch(() => setError('Numéro ScanLinkPay introuvable'))
      .finally(() => setLoading(false));
  }, [number]);

  // Whole units: the payment providers do not take cents.
  const amountCents = (Number(amount) || 0) * 100;
  const canPay = amountCents >= 100 && !!merchantId && !paying;

  const handlePay = async () => {
    setPaying(true);
    setError('');
    try {
      const { data } = await api.post('/payment-requests/quick-pay', {
        scanlinkpay_number: number,
        merchant_id: merchantId,
        amount_cents: amountCents,
        currency,
      });
      navigate(`/p/${data.link_token}`);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Échec de la création du paiement');
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <PublicShell>
        <PublicCard className="flex flex-col items-center py-14">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-3 text-sm text-muted-foreground">Recherche du commerçant…</p>
        </PublicCard>
      </PublicShell>
    );
  }

  if (error && !org) {
    return (
      <PublicShell>
        <PublicCard className="py-8">
          <ResultView tone="error" icon={SearchX} title="Numéro introuvable" message={`Aucun commerçant ScanLinkPay ne porte le numéro ${number ?? ''}. Vérifiez-le auprès du commerçant.`} />
        </PublicCard>
      </PublicShell>
    );
  }

  const o = org!;
  return (
    <PublicShell>
      <PublicCard>
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-brand">
            <Building2 className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Payer à</p>
            <p className="truncate text-base font-bold text-foreground">{o.name}</p>
          </div>
          <span className="ml-auto shrink-0 rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] font-semibold text-muted-foreground">{o.scanlinkpay_number}</span>
        </div>

        {o.merchants.length > 1 && (
          <div className="mt-5">
            <p className="mb-2 text-sm font-semibold text-foreground">Choisissez la boutique</p>
            <div role="radiogroup" aria-label="Boutique" className="space-y-2">
              {o.merchants.map((m) => {
                const selected = merchantId === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setMerchantId(m.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-2xl border-2 px-3.5 py-3 text-left transition-colors',
                      selected ? 'border-primary bg-primary/[0.06]' : 'border-border hover:border-primary/40',
                    )}
                  >
                    <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', selected ? 'bg-brand-gradient text-white' : 'bg-muted text-muted-foreground')}>
                      <Store className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{m.name}</span>
                    <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
                      {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {o.merchants.length === 0 && (
          <p className="mt-5 flex items-start gap-2 rounded-xl bg-warning/10 px-3.5 py-3 text-sm font-medium text-warning">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> Cette entreprise n'a pas encore de boutique pouvant recevoir un paiement.
          </p>
        )}
      </PublicCard>

      <PublicCard>
        <AmountEntry value={amount} onChange={setAmount} currency={currency} onCurrencyChange={setCurrency} label="Montant à payer" error={error || undefined} />
        <Button className="mt-5 h-[52px] w-full rounded-xl text-base font-semibold" disabled={!canPay} onClick={handlePay}>
          {paying ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
          Continuer
          {!paying && <ArrowRight className="ml-2 h-5 w-5" />}
        </Button>
        <p className="mt-3 text-center text-xs text-muted-foreground">Vous choisirez ensuite comment payer : Mobile Money ou votre solde ScanLinkPay.</p>
      </PublicCard>
    </PublicShell>
  );
}
