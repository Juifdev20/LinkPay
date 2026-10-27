import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QrScanner from 'qr-scanner';
import QrScannerWorkerPath from 'qr-scanner/qr-scanner-worker.min.js?url';
import { Button } from '@/components/ui/button';
import { X, Keyboard, AlertCircle } from 'lucide-react';
import { beepError, beepOk } from '@/lib/sound';

QrScanner.WORKER_PATH = QrScannerWorkerPath;

/** Extracts the payment-link token from a scanned ScanLinkPay QR (which encodes
 * the full `{FRONTEND_URL}/p/{token}` URL — see linkpay-api's
 * payment-requests.service.ts). Accepts any host, only the /p/:token path
 * shape matters, since the QR always carries the real production domain
 * regardless of which origin the scanning device itself is running on
 * (e.g. the Capacitor app's `https://localhost`). */
function extractPaymentToken(scanned: string): string | null {
  const match = scanned.match(/\/p\/([^/?#]+)/);
  return match ? match[1] : null;
}

/** Recognizes a scanned personal wallet number (see Receive.tsx, which
 * encodes the number as-is with no URL wrapper) — both the current SLP-
 * prefix and the legacy LP- one still carried by wallets created before
 * the rebrand. */
/** A ScanLinkPay CARD: its QR code holds a link ending in /c/<12 characters>. */
function extractCardToken(scanned: string): string | null {
  const match = scanned.match(/\/c\/([0-9A-Za-z]{12})(?:[/?#].*)?$/);
  return match ? match[1].toUpperCase() : null;
}

/** A business's fixed payment QR (organizations' and merchants'
 * scanlinkpay_qr_url) encodes `{FRONTEND_URL}/pay/{SLP-…}` — the public
 * pay-by-number page where the payer picks the amount. Same host-agnostic
 * reasoning as extractPaymentToken above. */
function extractPayNumber(scanned: string): string | null {
  const match = scanned.match(/\/pay\/([0-9A-Za-z-]+)/);
  return match ? match[1] : null;
}

function extractWalletNumber(scanned: string): string | null {
  const trimmed = scanned.trim();
  return /^S?LP-[A-Z0-9-]+$/.test(trimmed) ? trimmed : null;
}

/**
 * Full-screen camera scanner — the "Scanner QR" entry point payers use to
 * pay a merchant's QR code (generated server-side, see CreatePaymentRequest
 * / payment-requests.service.ts). On a successful decode, navigates
 * in-app to /p/:token, reusing PaymentLinkPage's existing flow untouched
 * rather than duplicating its confirm/pay UI here.
 */
export default function ScanQrPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!videoRef.current) return;

    const scanner = new QrScanner(
      videoRef.current,
      (result) => {
        const token = extractPaymentToken(result.data);
        if (token) {
          scanner.stop();
          beepOk();
          navigate(`/p/${token}`);
          return;
        }
        const cardToken = extractCardToken(result.data);
        if (cardToken) {
          scanner.stop();
          beepOk();
          // The landing page sends a seller to the till and anybody else to "send money to this card's holder".
          navigate(`/c/${cardToken}`);
          return;
        }
        const payNumber = extractPayNumber(result.data);
        if (payNumber) {
          scanner.stop();
          beepOk();
          navigate(`/pay/${payNumber}`);
          return;
        }
        const walletNumber = extractWalletNumber(result.data);
        if (walletNumber) {
          scanner.stop();
          beepOk();
          navigate(`/dashboard/wallet/send?to=${encodeURIComponent(walletNumber)}`);
          return;
        }
        beepError();
        setError('QR non reconnu — ce code ne correspond pas à un lien de paiement ou un numéro ScanLinkPay.');
      },
      {
        preferredCamera: 'environment',
        highlightScanRegion: false, // our own aiming frame is drawn over the video
        highlightCodeOutline: true,
      },
    );
    scannerRef.current = scanner;

    scanner.start().catch(() => {
      setError("Impossible d'accéder à la caméra. Vérifiez que la permission est accordée à ScanLinkPay.");
    });

    return () => {
      scanner.stop();
      scanner.destroy();
      scannerRef.current = null;
    };
  }, [navigate]);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      <div className="flex items-center justify-between p-4 safe-area-top">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-black/40 flex items-center justify-center text-white"
          aria-label="Fermer"
        >
          <X className="w-5 h-5" />
        </button>
        <p className="text-white font-semibold">Scanner un QR code</p>
        <div className="w-10" />
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline />

        {/* The aiming frame */}
        {!error && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center" aria-hidden>
            <div className="relative h-64 w-64 max-w-[72vw] max-h-[72vw]">
              {['left-0 top-0 border-l-4 border-t-4 rounded-tl-3xl', 'right-0 top-0 border-r-4 border-t-4 rounded-tr-3xl', 'left-0 bottom-0 border-l-4 border-b-4 rounded-bl-3xl', 'right-0 bottom-0 border-r-4 border-b-4 rounded-br-3xl'].map((c) => (
                <span key={c} className={`absolute h-12 w-12 border-white ${c}`} />
              ))}
              <span className="absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-sky-300/80 shadow-[0_0_12px_2px_rgba(125,211,252,0.6)] animate-pulse" />
            </div>
            <p className="mt-6 rounded-full bg-black/45 px-4 py-2 text-sm font-medium text-white backdrop-blur">Placez le QR code dans le cadre</p>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6 bg-black/70">
            <div className="max-w-xs text-center">
              <div className="w-14 h-14 rounded-2xl bg-destructive/20 flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-7 h-7 text-destructive" />
              </div>
              <p className="text-white text-sm mb-6">{error}</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setError('');
                  scannerRef.current?.start().catch(() => {
                    setError("Impossible d'accéder à la caméra. Vérifiez que la permission est accordée à ScanLinkPay.");
                  });
                }}
              >
                Réessayer
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="p-6 safe-area-bottom">
        <Button
          variant="outline"
          className="h-[52px] w-full rounded-xl border-white/25 bg-white/10 text-base font-semibold text-white backdrop-blur hover:bg-white/20 hover:text-white"
          onClick={() => navigate('/dashboard/wallet/pay')}
        >
          <Keyboard className="mr-2 w-4 h-4" />
          Saisir le code manuellement
        </Button>
      </div>
    </div>
  );
}
