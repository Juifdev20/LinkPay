import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import QrScanner from 'qr-scanner';
import QrScannerWorkerPath from 'qr-scanner/qr-scanner-worker.min.js?url';
import { Button } from '@/components/ui/button';
import { X, Keyboard, AlertCircle } from 'lucide-react';

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
        if (!token) {
          setError('QR non reconnu — ce code ne correspond pas à un lien de paiement ScanLinkPay.');
          return;
        }
        scanner.stop();
        navigate(`/p/${token}`);
      },
      {
        preferredCamera: 'environment',
        highlightScanRegion: true,
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
          className="w-full border-white/30 text-white hover:bg-white/10 hover:text-white"
          size="lg"
          onClick={() => navigate('/dashboard/wallet/pay')}
        >
          <Keyboard className="mr-2 w-4 h-4" />
          Saisir le code manuellement
        </Button>
      </div>
    </div>
  );
}
