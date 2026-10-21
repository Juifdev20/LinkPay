import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import QrScanner from 'qr-scanner';
import QrScannerWorkerPath from 'qr-scanner/qr-scanner-worker.min.js?url';
import { CreditCard, Loader2, ScanLine, Smartphone, X } from 'lucide-react';
import api from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { groupDigits } from '@/lib/cards';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { AmountEntry } from '@/components/payment/AmountEntry';
import { ResultView } from '@/components/ResultView';
import { cn } from '@/lib/utils';

QrScanner.WORKER_PATH = QrScannerWorkerPath;

type Step = 'card' | 'amount' | 'waiting' | 'done';
type Outcome = 'approved' | 'expired' | 'declined' | 'cancelled';

const OUTCOME: Record<Outcome, { title: string; text: string; ok: boolean }> = {
  approved: { title: 'Paiement reçu', text: 'Le client a confirmé avec son PIN.', ok: true },
  expired: { title: 'Délai dépassé', text: "Le client n'a pas confirmé à temps. Rien n'a été débité.", ok: false },
  declined: { title: 'Paiement refusé', text: 'Le client a refusé la demande. Rien n\'a été débité.', ok: false },
  cancelled: { title: 'Demande annulée', text: 'Rien n\'a été débité.', ok: false },
};

/** "https://…/c/K7Q2M9XD4TWB" → the token; a typed token works too. */
const tokenOf = (scanned: string) => {
  const m = /\/c\/([0-9A-Za-z]{12})(?:[/?#].*)?$/.exec(scanned.trim());
  return (m ? m[1] : scanned.trim()).toUpperCase();
};

/** The till: scan the customer's ScanLinkPay card (or type its number), enter the amount, the customer confirms on their phone. */
export default function ChargeCardPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState<Step>(params.get('t') ? 'amount' : 'card');
  const [qrToken, setQrToken] = useState(params.get('t') ? tokenOf(params.get('t')!) : '');
  const [cardNumber, setCardNumber] = useState('');
  const [scanning, setScanning] = useState(false);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'CDF' | 'USD'>('CDF');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [charge, setCharge] = useState<{ id: string; holder: string; amount_cents: number; currency: string; expires_at: string } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Camera
  useEffect(() => {
    if (!scanning || !videoRef.current) return;
    const scanner = new QrScanner(
      videoRef.current,
      (r) => {
        const t = tokenOf(r.data);
        if (/^[0-9A-Z]{12}$/.test(t) && /\/c\//.test(r.data)) {
          scanner.stop();
          setScanning(false);
          setQrToken(t);
          setStep('amount');
        } else {
          setError("Ce QR code n'est pas une carte ScanLinkPay.");
        }
      },
      { preferredCamera: 'environment', highlightScanRegion: true, highlightCodeOutline: true },
    );
    scanner.start().catch(() => { setScanning(false); setError("Impossible d'accéder à la caméra. Saisissez le numéro de la carte."); });
    return () => { scanner.stop(); scanner.destroy(); };
  }, [scanning]);

  // Follow the charge until the customer has answered
  useEffect(() => {
    if (step !== 'waiting' || !charge) return;
    let alive = true;
    const tick = async () => {
      try {
        const { data } = await api.get(`/cards/merchant-charges/${charge.id}`);
        if (!alive) return;
        if (data.status !== 'pending' && data.status !== 'processing') {
          setOutcome(data.status as Outcome);
          setStep('done');
        }
      } catch {
        // A hiccup: the next tick tries again.
      }
    };
    const poll = setInterval(tick, 2000);
    const clock = setInterval(() => setSecondsLeft(Math.max(0, Math.round((new Date(charge.expires_at).getTime() - Date.now()) / 1000))), 500);
    return () => { alive = false; clearInterval(poll); clearInterval(clock); };
  }, [step, charge]);

  // Whole units, like every other amount entry of the app.
  const amountCents = (Number(amount) || 0) * 100;

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      const body: Record<string, unknown> = { amount_cents: amountCents, currency };
      if (qrToken) body.qr_token = qrToken; else body.card_number = cardNumber;
      const { data } = await api.post('/cards/merchant-charges', body);
      setCharge({ id: data.charge_id, holder: data.holder, amount_cents: data.amount_cents, currency: data.currency, expires_at: data.expires_at });
      setSecondsLeft(Math.round((new Date(data.expires_at).getTime() - Date.now()) / 1000));
      setStep('waiting');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Impossible de créer la demande.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!charge) return;
    try { await api.post(`/cards/merchant-charges/${charge.id}/cancel`); } catch { /* it just got paid or closed: the next poll tells */ }
    setOutcome('cancelled');
    setStep('done');
  };

  const reset = () => {
    setStep('card'); setQrToken(''); setCardNumber(''); setAmount(''); setCharge(null); setOutcome(null); setError('');
  };

  const steps = ['Carte', 'Montant', 'Confirmation'];
  const stepIndex = step === 'card' ? 0 : step === 'amount' ? 1 : 2;

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-5 pb-28 md:p-6">
      <PageHeader title="Encaisser par carte" />

      {/* Where we are in the three steps */}
      <ol className="flex items-center gap-2" aria-label="Étapes">
        {steps.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', i <= stepIndex ? 'bg-brand-gradient text-white' : 'bg-muted text-muted-foreground')}>{i + 1}</span>
            <span className={cn('truncate text-xs font-semibold', i <= stepIndex ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
            {i < steps.length - 1 && <span className={cn('h-0.5 flex-1 rounded-full', i < stepIndex ? 'bg-primary' : 'bg-border')} />}
          </li>
        ))}
      </ol>

      {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}

      {step === 'card' && (
        <section className="space-y-5 rounded-3xl border border-border bg-card p-5 shadow-soft">
          {scanning ? (
            <div className="relative aspect-square overflow-hidden rounded-2xl bg-black">
              <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
              <button type="button" onClick={() => setScanning(false)} aria-label="Arrêter la caméra" className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setError(''); setScanning(true); }}
              className="flex w-full flex-col items-center rounded-2xl border-2 border-dashed border-primary/40 bg-primary/[0.05] px-4 py-8 transition-colors hover:bg-primary/[0.09]"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-brand"><ScanLine className="h-8 w-8" /></span>
              <span className="mt-3 text-base font-bold text-foreground">Scanner la carte du client</span>
              <span className="mt-1 text-sm text-muted-foreground">Visez le QR code imprimé sur sa carte</span>
            </button>
          )}

          <div className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> ou saisissez son numéro <span className="h-px flex-1 bg-border" />
          </div>

          <div>
            <div className="relative">
              <CreditCard className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
              <input
                id="num"
                aria-label="Numéro de la carte"
                inputMode="numeric"
                autoComplete="off"
                placeholder="0000 0000 0000 0000"
                value={cardNumber}
                onChange={(e) => setCardNumber(groupDigits(e.target.value))}
                className="h-12 w-full rounded-xl border border-input bg-background pl-11 pr-4 font-mono text-base tracking-wider text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <Button className="mt-3 h-12 w-full rounded-xl font-semibold" disabled={cardNumber.replace(/\D/g, '').length !== 16} onClick={() => { setQrToken(''); setStep('amount'); }}>
              Continuer
            </Button>
          </div>
        </section>
      )}

      {step === 'amount' && (
        <section className="space-y-5 rounded-3xl border border-border bg-card p-5 shadow-soft">
          <div className="flex items-center gap-3 rounded-2xl bg-muted/60 px-4 py-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gradient text-white"><CreditCard className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{qrToken ? 'Carte scannée' : 'Carte saisie'}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{qrToken ? 'Carte ScanLinkPay' : cardNumber}</p>
            </div>
            <button type="button" onClick={reset} className="shrink-0 text-sm font-semibold text-primary hover:underline">Changer</button>
          </div>
          <AmountEntry value={amount} onChange={setAmount} currency={currency} onCurrencyChange={setCurrency} label="Montant à encaisser" autoFocus />
          <Button className="h-[52px] w-full rounded-xl text-base font-semibold" disabled={busy || amountCents < 100} onClick={submit}>
            {busy && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
            Demander {amountCents >= 100 ? formatCurrency(amountCents, currency) : ''}
          </Button>
        </section>
      )}

      {step === 'waiting' && charge && (
        <section className="rounded-3xl border border-border bg-card px-5 py-8 shadow-soft">
          <ResultView
            tone="pending"
            icon={Smartphone}
            title={`En attente de ${charge.holder}`}
            amount={formatCurrency(charge.amount_cents, charge.currency)}
            message="Le client confirme avec son code PIN sur son téléphone."
            rows={[{ label: 'Temps restant', value: `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`, className: 'tabular-nums' }]}
          >
            <Button variant="outline" className="h-12 w-full rounded-xl" onClick={cancel}>Annuler la demande</Button>
          </ResultView>
        </section>
      )}

      {step === 'done' && outcome && (
        <section className="rounded-3xl border border-border bg-card px-5 py-8 shadow-soft">
          <ResultView
            tone={OUTCOME[outcome].ok ? 'success' : outcome === 'expired' ? 'waiting' : 'error'}
            title={OUTCOME[outcome].title}
            amount={charge ? formatCurrency(charge.amount_cents, charge.currency) : undefined}
            message={OUTCOME[outcome].text}
          >
            <Button className="h-[52px] w-full rounded-xl text-base font-semibold" onClick={reset}>Nouvel encaissement</Button>
            <Button variant="ghost" className="h-12 w-full rounded-xl" onClick={() => navigate('/dashboard')}>Terminer</Button>
          </ResultView>
        </section>
      )}
    </div>
  );
}
