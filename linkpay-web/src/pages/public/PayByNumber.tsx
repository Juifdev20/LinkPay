import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Logo } from '@/components/Logo';
import { CurrencySelector } from '@/components/CurrencySelector';
import { Loader2, AlertCircle, Building2, Store, Lock } from 'lucide-react';

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
    api.get(`/organizations/pay/${number}`)
      .then(({ data }) => {
        setOrg(data);
        if (data.merchants.length === 1) setMerchantId(data.merchants[0].id);
      })
      .catch(() => setError('Numéro ScanLinkPay introuvable'))
      .finally(() => setLoading(false));
  }, [number]);

  const amountCents = Math.round((parseFloat(amount) || 0) * 100);
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
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error && !org) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-background">
        <div className="w-full max-w-md">
          <div className="flex justify-center mb-8">
            <Logo size="lg" />
          </div>
          <Card className="text-center">
            <CardContent className="pt-6">
              <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8 text-destructive" />
              </div>
              <p className="text-muted-foreground">{error}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 bg-background">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Logo size="lg" />
        </div>
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-6 h-6 text-primary" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-foreground truncate">{org!.name}</h2>
                <p className="text-xs text-muted-foreground font-mono">{org!.scanlinkpay_number}</p>
              </div>
            </div>

            {org!.merchants.length > 1 && (
              <div className="space-y-2">
                <Label className="font-semibold">Boutique</Label>
                <div className="space-y-2">
                  {org!.merchants.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMerchantId(m.id)}
                      className={`w-full flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-colors ${
                        merchantId === m.id ? 'border-primary bg-primary/5' : 'border-input hover:bg-accent'
                      }`}
                    >
                      <Store className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <span className="text-sm font-medium text-foreground truncate">{m.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {org!.merchants.length === 0 && (
              <p className="text-sm text-warning">Cette entreprise n'a pas encore de boutique pouvant recevoir un paiement.</p>
            )}

            <div className="space-y-2">
              <Label>Devise</Label>
              <CurrencySelector value={currency} onChange={setCurrency} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount" className="font-semibold">Montant ({currency})</Label>
              <Input
                id="amount"
                type="number"
                inputMode="decimal"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            {error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">
                {error}
              </div>
            )}

            <Button className="w-full" size="lg" disabled={!canPay} onClick={handlePay}>
              {paying && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
              <Lock className="mr-2 w-4 h-4" />
              Continuer
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
