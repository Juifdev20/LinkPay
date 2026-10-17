import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import QrScanner from 'qr-scanner';
import QrScannerWorkerPath from 'qr-scanner/qr-scanner-worker.min.js?url';
import { CheckCircle2, CreditCard, Loader2, ScanLine, XCircle } from 'lucide-react';
import api from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { groupDigits } from '@/lib/cards';
import { PageHeader } from '@/components/PageHeader';
import { CurrencySelector } from '@/components/CurrencySelector';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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

  const amountCents = Math.round((parseFloat(amount.replace(',', '.')) || 0) * 100);

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

  return (
    <div className="p-4 max-w-md mx-auto space-y-5 pb-28">
      <PageHeader title="Encaisser par carte" />

      {step === 'card' && (
        <div className="space-y-4">
          {scanning ? (
            <div className="rounded-2xl overflow-hidden bg-black aspect-square relative">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
            </div>
          ) : (
            <Button className="w-full h-14" onClick={() => { setError(''); setScanning(true); }}>
              <ScanLine className="w-5 h-5 mr-2" /> Scanner la carte du client
            </Button>
          )}
          <div className="space-y-2">
            <Label htmlFor="num">Ou saisissez le numéro de la carte</Label>
            <Input id="num" inputMode="numeric" autoComplete="off" placeholder="0000 0000 0000 0000" value={cardNumber} onChange={(e) => setCardNumber(groupDigits(e.target.value))} />
            <Button variant="outline" className="w-full" disabled={cardNumber.replace(/\D/g, '').length !== 16} onClick={() => { setQrToken(''); setStep('amount'); }}>
              Continuer
            </Button>
          </div>
        </div>
      )}

      {step === 'amount' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3">
            <CreditCard className="w-6 h-6 text-primary" />
            <p className="text-sm">{qrToken ? 'Carte ScanLinkPay scannée' : `Carte ${cardNumber}`}</p>
          </div>
          <CurrencySelector value={currency} onChange={setCurrency} />
          <div className="space-y-2">
            <Label htmlFor="amount">Montant à encaisser</Label>
            <Input id="amount" inputMode="decimal" autoFocus placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={reset}>Changer de carte</Button>
            <Button className="flex-1" disabled={busy || amountCents < 100} onClick={submit}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Demander
            </Button>
          </div>
        </div>
      )}

      {step === 'waiting' && charge && (
        <div className="rounded-2xl border border-border bg-card p-6 text-center space-y-3">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
          <p className="font-semibold">En attente de {charge.holder}</p>
          <p className="text-2xl font-bold">{formatCurrency(charge.amount_cents, charge.currency)}</p>
          <p className="text-sm text-muted-foreground">Le client confirme avec son PIN sur son téléphone. Il reste {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}.</p>
          <Button variant="outline" className="w-full" onClick={cancel}>Annuler la demande</Button>
        </div>
      )}

      {step === 'done' && outcome && (
        <div className="rounded-2xl border border-border bg-card p-6 text-center space-y-3">
          {OUTCOME[outcome].ok ? <CheckCircle2 className="w-12 h-12 text-success mx-auto" /> : <XCircle className="w-12 h-12 text-destructive mx-auto" />}
          <p className="font-bold text-lg">{OUTCOME[outcome].title}</p>
          <p className="text-sm text-muted-foreground">{OUTCOME[outcome].text}</p>
          <Button className="w-full" onClick={reset}>Nouvel encaissement</Button>
          <Button variant="ghost" className="w-full" onClick={() => navigate('/dashboard')}>Terminer</Button>
        </div>
      )}

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}
