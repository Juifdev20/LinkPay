import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { PublicShell, PublicCard } from '@/components/public/PublicShell';
import { ResultView } from '@/components/ResultView';
import { AuthField } from '@/components/auth/AuthField';
import { MobileMoneyFields } from '@/components/payment/MobileMoneyFields';
import { MobileMoneyWaiting } from '@/components/payment/MobileMoneyWaiting';
import { isNumberReady, toApiPhone } from '@/lib/mobile-money';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Loader2, Lock, User, Wallet as WalletIcon, ShieldCheck, Store, Link2 as LinkIcon } from 'lucide-react';
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

  // A guest (shared link, QR scanned outside the app) has nowhere in-app to go back to: the back arrow only shows for
  // a signed-in user (e.g. arrived via the in-app QR scanner).
  const back = isAuthenticated ? () => navigate('/dashboard') : undefined;

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
      <PublicShell onBack={back}>
        <PublicCard className="flex flex-col items-center py-14">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-3 text-sm text-muted-foreground">Chargement du paiement…</p>
        </PublicCard>
      </PublicShell>
    );
  }

  if (error || !request) {
    return (
      <PublicShell onBack={back}>
        <PublicCard className="py-8">
          <ResultView tone="error" icon={LinkIcon} title="Lien introuvable" message="Ce lien de paiement n'existe pas ou n'est plus valable. Demandez un nouveau lien au commerçant." />
        </PublicCard>
      </PublicShell>
    );
  }

  const merchantName = request.merchant?.name || 'Commerçant';
  const total = formatCurrency(request.amount_cents, request.currency);

  if (request.status === 'PAID') {
    return (
      <PublicShell onBack={back}>
        <PublicCard className="py-8">
          <ResultView
            tone="success"
            title="Déjà payé"
            amount={total}
            message={`Ce paiement à ${merchantName} a déjà été effectué. Il n'y a rien d'autre à faire.`}
            rows={[{ label: 'Référence', value: request.reference, copy: request.reference }]}
          />
        </PublicCard>
      </PublicShell>
    );
  }

  if (request.status === 'CANCELLED' || request.status === 'EXPIRED') {
    const expired = request.status === 'EXPIRED';
    return (
      <PublicShell onBack={back}>
        <PublicCard className="py-8">
          <ResultView
            tone="waiting"
            title={expired ? 'Lien expiré' : 'Lien annulé'}
            message={`${expired ? 'Ce lien n\'est plus valable.' : `${merchantName} a annulé cette demande.`} Demandez un nouveau lien au commerçant si vous souhaitez toujours payer.`}
            rows={[{ label: 'Référence', value: request.reference, copy: request.reference }]}
          />
        </PublicCard>
      </PublicShell>
    );
  }

  // Waiting for the customer to confirm on their own phone: ScanLinkPay never sees their Mobile Money secret code.
  if (paying) {
    return (
      <PublicShell>
        <PublicCard className="p-0 sm:p-0">
          <MobileMoneyWaiting operator={operator} phone={customerPhone} amountCents={request.amount_cents} currency={request.currency} />
        </PublicCard>
      </PublicShell>
    );
  }

  const walletPay = `/dashboard/wallet/pay?ref=${encodeURIComponent(request.reference)}`;

  return (
    <PublicShell onBack={back}>
      {/* What is being paid, like a receipt */}
      <PublicCard className="p-0 sm:p-0">
        <div className="p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <MerchantAvatar name={merchantName} logo={request.merchant?.logo_url} />
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">Paiement à</p>
              <p className="truncate text-base font-bold text-foreground">{merchantName}</p>
            </div>
          </div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Montant à payer</p>
          <p className="mt-1 text-[2.5rem] font-extrabold leading-none tracking-tight tabular-nums text-foreground">{total}</p>
          {request.description && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{request.description}</p>}
        </div>
        <div className="relative border-t border-dashed border-border px-5 py-3.5 text-sm sm:px-6">
          <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full border border-border bg-background" aria-hidden />
          <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full border border-border bg-background" aria-hidden />
          <div className="flex items-center justify-between gap-3 py-1">
            <span className="text-muted-foreground">Référence</span>
            <span className="truncate font-mono text-xs font-semibold text-foreground">{request.reference}</span>
          </div>
          {request.expires_at && (
            <div className="flex items-center justify-between gap-3 py-1">
              <span className="text-muted-foreground">Valable jusqu'au</span>
              <span className="font-medium text-foreground">{formatDate(request.expires_at)}</span>
            </div>
          )}
        </div>
      </PublicCard>

      {/* How to pay */}
      <PublicCard>
        {isAuthenticated ? (
          <Button asChild className="h-[52px] w-full rounded-xl text-base font-semibold">
            <Link to={walletPay}>
              <WalletIcon className="mr-2 h-5 w-5" /> Payer avec mon solde
            </Link>
          </Button>
        ) : (
          <div className="rounded-2xl bg-primary/[0.06] p-4 ring-1 ring-primary/15">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white">
                <WalletIcon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">Vous avez un compte ScanLinkPay ?</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">Payez en deux touches avec votre solde, ou créez un compte en quelques secondes.</p>
              </div>
            </div>
            <div className="mt-3.5 grid grid-cols-2 gap-2">
              <Button asChild variant="outline" className="h-11 rounded-xl">
                <Link to={`/register?redirect=${encodeURIComponent(walletPay)}`}>Créer un compte</Link>
              </Button>
              <Button asChild className="h-11 rounded-xl">
                <Link to={`/login?redirect=${encodeURIComponent(walletPay)}`}>Se connecter</Link>
              </Button>
            </div>
          </div>
        )}

        <div className="my-5 flex items-center gap-3 text-xs font-medium text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> ou par Mobile Money, sans compte <span className="h-px flex-1 bg-border" />
        </div>

        <div className="space-y-5">
          <AuthField
            id="name"
            label={<>Votre nom <span className="font-normal text-muted-foreground">(facultatif)</span></>}
            icon={User}
            autoComplete="name"
            placeholder="Ex. Kambale Doli"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            hint="Le commerçant le verra sur son reçu."
            className="mb-0"
          />
          <MobileMoneyFields operator={operator} onOperatorChange={setOperator} phone={customerPhone} onPhoneChange={setCustomerPhone} />
          <Button className="h-[52px] w-full rounded-xl text-base font-semibold" onClick={handlePay} disabled={paying || !isNumberReady(operator, customerPhone)}>
            <Lock className="mr-2 h-4 w-4" /> Payer {total}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-success" />
            Votre code secret Mobile Money reste sur votre téléphone.
          </p>
        </div>
      </PublicCard>
    </PublicShell>
  );
}

/** The shop's logo, or its initials on the brand gradient. */
function MerchantAvatar({ name, logo }: { name: string; logo?: string | null }) {
  const [broken, setBroken] = useState(false);
  if (logo && !broken) {
    return <img src={logo} alt="" onError={() => setBroken(true)} className="h-12 w-12 shrink-0 rounded-2xl border border-border object-cover" />;
  }
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-gradient text-base font-bold text-white shadow-brand">
      {initials || <Store className="h-5 w-5" />}
    </span>
  );
}
