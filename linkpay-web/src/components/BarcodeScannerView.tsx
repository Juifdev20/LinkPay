import { useEffect, useRef, useState } from 'react';
import type { IScannerControls } from '@zxing/browser';
import { AlertCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Retail codes (EAN/UPC on packaging, Code128 on many labels) + QR.
const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];
// Holding a product in front of the camera reads it many times a second —
// the same code is ignored for this long so it's added once.
const REPEAT_GUARD_MS = 1500;

/**
 * Full-screen camera barcode reader. Uses the browser's native
 * BarcodeDetector when it reads retail codes (Chrome / Android WebView —
 * fast, hardware-assisted), else the ZXing JS decoder. The existing
 * qr-scanner library can't be reused: it only reads QR codes, not the
 * EAN-13 barcodes printed on products.
 *
 * continuous: stays open after each read (the till — scan item after item);
 * otherwise closes on the first code (filling a product's barcode field).
 */
export function BarcodeScannerView({
  title,
  continuous = false,
  onDetected,
  onClose,
  status,
}: {
  title: string;
  continuous?: boolean;
  onDetected: (code: string) => void;
  onClose: () => void;
  /** Feedback line under the video (e.g. last product added). */
  status?: React.ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // Latest callbacks without restarting the camera on every parent render.
  const onDetectedRef = useRef(onDetected);
  const onCloseRef = useRef(onClose);
  onDetectedRef.current = onDetected;
  onCloseRef.current = onClose;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let controls: IScannerControls | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastCode = '';
    let lastAt = 0;

    const handle = (code: string) => {
      if (stopped || !code) return;
      const now = Date.now();
      if (code === lastCode && now - lastAt < REPEAT_GUARD_MS) return;
      lastCode = code;
      lastAt = now;
      onDetectedRef.current(code);
      if (!continuous) {
        stopped = true;
        onCloseRef.current();
      }
    };

    const startNative = async (formats: string[]) => {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (stopped) return;
      video.srcObject = stream;
      await video.play();
      const detector = new (window as any).BarcodeDetector({ formats });
      const tick = async () => {
        if (stopped) return;
        try {
          if (video.readyState >= 2) {
            const found = await detector.detect(video);
            if (found.length) handle(found[0].rawValue);
          }
        } catch { /* a frame that fails to decode — keep going */ }
        timer = setTimeout(tick, 120);
      };
      tick();
    };

    const startZxing = async () => {
      // Loaded only when needed — the JS decoder is large and most Android
      // devices use the native BarcodeDetector path instead.
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import('@zxing/browser'),
        import('@zxing/library'),
      ]);
      if (stopped) return;
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.QR_CODE,
      ]);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
      controls = await reader.decodeFromConstraints(
        { video: { facingMode: 'environment' }, audio: false },
        video,
        (result) => { if (result) handle(result.getText()); },
      );
      if (stopped) controls.stop();
    };

    (async () => {
      try {
        const BD = (window as any).BarcodeDetector;
        const supported: string[] = BD?.getSupportedFormats ? await BD.getSupportedFormats() : [];
        const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
        if (formats.includes('ean_13')) await startNative(formats);
        else await startZxing();
      } catch {
        if (!stopped) setError("Impossible d'accéder à la caméra. Vérifiez que la permission est accordée à ScanLinkPay.");
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [continuous, attempt]);

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      <div className="flex items-center justify-between p-4 safe-area-top">
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-black/40 flex items-center justify-center text-white"
          aria-label="Fermer"
        >
          <X className="w-5 h-5" />
        </button>
        <p className="text-white font-semibold">{title}</p>
        <div className="w-10" />
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline />

        {/* Aiming guide — a wide box, barcodes are landscape */}
        {!error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-[80%] max-w-md h-36 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-6 bg-black/70">
            <div className="max-w-xs text-center">
              <div className="w-14 h-14 rounded-2xl bg-destructive/20 flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-7 h-7 text-destructive" />
              </div>
              <p className="text-white text-sm mb-6">{error}</p>
              <Button variant="secondary" onClick={() => { setError(''); setAttempt((a) => a + 1); }}>
                Réessayer
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 pb-8 safe-area-bottom space-y-3">
        <div className="min-h-[2.5rem] text-center text-sm text-white">
          {status ?? <span className="text-white/70">Placez le code-barres dans le cadre</span>}
        </div>
        {continuous && (
          <Button className="w-full" size="lg" onClick={onClose}>Terminer</Button>
        )}
      </div>
    </div>
  );
}
