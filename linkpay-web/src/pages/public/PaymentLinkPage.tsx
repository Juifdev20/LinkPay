import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Logo } from '@/components/Logo';
import { formatCurrency, formatDate } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { Loader2, CheckCircle, AlertCircle, Lock, User, Phone, Smartphone, CreditCard } from 'lucide-react';

const OPERATORS = [
  { value: 'airtel', label: 'Airtel Money' },
  { value: 'orange', label: 'Orange Money' },
  { value: 'vodacom', label: 'M-Pesa (Vodacom)' },
];

export default function PaymentLinkPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [request, setRequest] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'mobile_money' | 'card'>('mobile_money');
  const [operator, setOperator] = useState(OPERATORS[0].value);

  useEffect(() => {
    api.get(`/payment-requests/link/${token}`)
      .then(({ data }) => setRequest(data))
      .catch(() => setError('Lien de paiement invalide ou expiré'))
      .finally(() => setLoading(false));
  }, [token]);

  const handlePay = async () => {
    setPaying(true);
    setError('');
    try {
      const { data } = await api.post(
        '/payments',
        {
          link_token: token,
          customer_name: customerName,
          customer_phone: customerPhone,
          payment_method: paymentMethod,
          mobile_money_operator: paymentMethod === 'mobile_money' ? operator : undefined,
        },
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      );
      if (data.status === 'SUCCESS') {
        navigate('/payment/result', { state: { status: 'success', reference: data.reference } });
      } else if (data.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        navigate('/payment/result', { state: { status: 'failed' } });
      }
    } catch (err: any) {
      navigate('/payment/result', { state: { status: 'failed', message: err.response?.data?.message } });
    } finally {
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

  if (error || !request) {
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
              <p className="text-muted-foreground">{error || 'Lien introuvable'}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (request.status === 'PAID') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-background">
        <div className="w-full max-w-md">
          <div className="flex justify-center mb-8">
            <Logo size="lg" />
          </div>
          <Card className="text-center">
            <CardContent className="pt-6">
              <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-8 h-8 text-success" />
              </div>
              <h2 className="text-xl font-bold text-foreground mb-2">Paiement effectué</h2>
              <p className="text-muted-foreground">Ce lien a déjà été utilisé.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (request.status === 'CANCELLED' || request.status === 'EXPIRED') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-background">
        <div className="w-full max-w-md">
          <div className="flex justify-center mb-8">
            <Logo size="lg" />
          </div>
          <Card className="text-center">
            <CardContent className="pt-6">
              <div className="w-16 h-16 rounded-2xl bg-warning/10 flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8 text-warning" />
              </div>
              <h2 className="text-xl font-bold text-foreground mb-2">Lien {request.status === 'EXPIRED' ? 'expiré' : 'annulé'}</h2>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Waiting for the customer to confirm on their own phone — this mirrors a
  // real mobile money STK/USSD push, where LinkPay never sees the PIN and the
  // confirmation happens entirely on the customer's device.
  if (paying) {
    const operatorLabel = OPERATORS.find((o) => o.value === operator)?.label;
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-background">
        <div className="w-full max-w-md">
          <div className="flex justify-center mb-8">
            <Logo size="lg" />
          </div>
          <Card className="text-center">
            <CardContent className="pt-6">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Smartphone className="w-8 h-8 text-primary animate-pulse" />
              </div>
              <h2 className="text-xl font-bold text-foreground mb-2">Confirmez sur votre téléphone</h2>
              <p className="text-muted-foreground text-sm mb-1">
                Une demande {operatorLabel} a été envoyée au {customerPhone || 'numéro indiqué'}.
              </p>
              <p className="text-muted-foreground text-sm mb-6">
                Ouvrez l'application et entrez votre code PIN pour confirmer le paiement de{' '}
                {formatCurrency(request.amount_cents, request.currency)}.
              </p>
              <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
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
          <CardContent className="pt-6">
            <h2 className="text-2xl font-bold text-foreground mb-1">{formatCurrency(request.amount_cents, request.currency)}</h2>
            <p className="text-sm text-muted-foreground mb-6">
              {request.description || 'Paiement à ' + (request.merchant?.name || 'commerçant')}
            </p>
            <div className="rounded-xl bg-secondary p-3 text-sm mb-6">
              <div className="flex justify-between mb-1">
                <span className="text-muted-foreground">Référence</span>
                <span className="font-mono text-foreground">{request.reference}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Expire le</span>
                <span className="text-foreground">{request.expires_at ? formatDate(request.expires_at) : '—'}</span>
              </div>
            </div>

            <div className="space-y-2 mb-4">
              <Label className="font-semibold">Mode de paiement</Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('mobile_money')}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-colors',
                    paymentMethod === 'mobile_money'
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-input text-muted-foreground hover:bg-accent',
                  )}
                >
                  <Smartphone className="w-5 h-5" />
                  Mobile Money
                </button>
                <button
                  type="button"
                  disabled
                  title="Bientôt disponible"
                  className="flex flex-col items-center gap-1.5 rounded-xl border-2 border-input px-4 py-3 text-sm font-semibold text-muted-foreground/50 cursor-not-allowed relative"
                >
                  <CreditCard className="w-5 h-5" />
                  Carte bancaire
                  <span className="absolute -top-2 right-2 text-[10px] font-bold bg-secondary text-muted-foreground px-1.5 py-0.5 rounded-full">
                    Bientôt
                  </span>
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {paymentMethod === 'mobile_money' && (
                <div className="space-y-2">
                  <Label className="font-semibold">Opérateur</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {OPERATORS.map((op) => (
                      <button
                        key={op.value}
                        type="button"
                        onClick={() => setOperator(op.value)}
                        className={cn(
                          'rounded-lg border px-2 py-2 text-xs font-medium transition-colors',
                          operator === op.value
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-input text-muted-foreground hover:bg-accent',
                        )}
                      >
                        {op.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="name" className="font-semibold">Votre nom</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input id="name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Kambale Doli Delphin" className="pl-10" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone" className="font-semibold">
                  {paymentMethod === 'mobile_money' ? 'Numéro Mobile Money' : 'Téléphone'}
                </Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input id="phone" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="+243 8XX XXX XXX" className="pl-10" />
                </div>
              </div>
              <Button className="w-full" size="lg" onClick={handlePay} disabled={paying || !customerPhone}>
                <Lock className="mr-2 w-4 h-4" />
                Payer {formatCurrency(request.amount_cents, request.currency)}
              </Button>
              <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
                <Lock className="w-3 h-3" />
                Paiement sécurisé — votre code PIN reste sur votre téléphone
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
