import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Logo } from '@/components/Logo';
import { PaymentMethodPicker } from '@/components/payment/PaymentMethodPicker';
import { MobileMoneyFields } from '@/components/payment/MobileMoneyFields';
import { MobileMoneyWaiting } from '@/components/payment/MobileMoneyWaiting';
import { isNumberReady, toApiPhone } from '@/lib/mobile-money';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Loader2, CheckCircle, AlertCircle, Lock, User, Wallet as WalletIcon, Sparkles, ArrowLeft } from 'lucide-react';
import { followCheckout } from '@/lib/safe-url';

export default function PaymentLinkPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [request, setRequest] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [customerName, setCustomerName] = useState('');
  // The 9 national digits of the Mobile Money number ("828497218"), see lib/mobile-money.
  const [customerPhone, setCustomerPhone] = useState('');
  const [operator, setOperator] = useState('airtel');

  useEffect(() => {
    api.get(`/payment-requests/link/${encodeURIComponent(token ?? "")}`)
      .then(({ data }) => setRequest(data))
      .catch(() => setError('Lien de paiement invalide ou expiré'))
      .finally(() => setLoading(false));
  }, [token]);

  // This page is also reachable by a guest with no LinkPay account (a
  // shared link/scanned QR from outside the app) — for them there's
  // nowhere in-app to "go back" to, so this only renders for an
  // already-authenticated user (e.g. arrived via the in-app QR scanner),
  // who'd otherwise be stuck here with no way back except the OS/browser
  // back gesture.
  const BackToDashboard = () =>
    isAuthenticated ? (
      <button
        onClick={() => navigate('/dashboard')}
        className="fixed top-4 left-4 z-10 w-10 h-10 rounded-full bg-card border border-border flex items-center justify-center text-foreground shadow-sm hover:bg-accent transition-colors"
        aria-label="Retour au tableau de bord"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>
    ) : null;

  const handlePay = async () => {
    setPaying(true);
    setError('');
    try {
      const { data } = await api.post(
        '/payments',
        {
          link_token: token,
          customer_name: customerName,
          customer_phone: toApiPhone(customerPhone),
          payment_method: 'mobile_money',
          mobile_money_operator: operator,
        },
        { headers: { 'Idempotency-Key': crypto.randomUUID() } },
      );
      if (data.status === 'SUCCESS') {
        navigate('/payment/result', { state: { status: 'success', reference: data.reference } });
      } else if (data.checkout_url) {
        followCheckout(data.checkout_url, navigate);
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
        <BackToDashboard />
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
        <BackToDashboard />
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
        <BackToDashboard />
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
  // real mobile money STK/USSD push, where ScanLinkPay never sees the PIN and the
  // confirmation happens entirely on the customer's device.
  if (paying) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-background">
        <div className="w-full max-w-md">
          <div className="flex justify-center mb-8">
            <Logo size="lg" />
          </div>
          <Card>
            <MobileMoneyWaiting operator={operator} phone={customerPhone} amountCents={request.amount_cents} currency={request.currency} />
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 bg-background">
      <BackToDashboard />
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

            {isAuthenticated ? (
              <Button
                asChild
                variant="outline"
                className="w-full mb-6 border-primary/30 text-primary hover:bg-primary/5"
                size="lg"
              >
                <Link to={`/dashboard/wallet/pay?ref=${encodeURIComponent(request.reference)}`}>
                  <WalletIcon className="mr-2 w-4 h-4" />
                  Payer avec mon solde ScanLinkPay
                </Link>
              </Button>
            ) : (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 mb-6">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-4 h-4 text-primary flex-shrink-0" />
                  <p className="text-sm font-semibold text-foreground">Payer avec votre solde ScanLinkPay ?</p>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Créez votre compte en quelques secondes et profitez de toutes les fonctionnalités ScanLinkPay.
                </p>
                <div className="flex gap-2">
                  <Button asChild size="sm" className="flex-1">
                    <Link to={`/register?redirect=${encodeURIComponent(`/dashboard/wallet/pay?ref=${request.reference}`)}`}>
                      S'inscrire
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline" className="flex-1">
                    <Link to={`/login?redirect=${encodeURIComponent(`/dashboard/wallet/pay?ref=${request.reference}`)}`}>
                      J'ai déjà un compte
                    </Link>
                  </Button>
                </div>
              </div>
            )}

            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-card px-2 text-muted-foreground">ou payer par Mobile Money (sans compte)</span>
              </div>
            </div>

            <div className="space-y-5">
              <PaymentMethodPicker value="mobile_money" onChange={() => {}} methods={['mobile_money', 'card']} disabled={['card']} />
              <div className="space-y-2">
                <Label htmlFor="name" className="font-semibold">Votre nom</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input id="name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Kambale Doli Delphin" className="pl-10 h-12 rounded-xl" />
                </div>
              </div>
              <MobileMoneyFields operator={operator} onOperatorChange={setOperator} phone={customerPhone} onPhoneChange={setCustomerPhone} />
              <Button className="w-full" size="lg" onClick={handlePay} disabled={paying || !isNumberReady(operator, customerPhone)}>
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
