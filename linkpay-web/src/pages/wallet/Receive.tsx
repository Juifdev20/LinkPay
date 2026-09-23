import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormSheet } from '@/components/FormSheet';
import { shareOrCopy } from '@/lib/share';
import { Loader2, Copy, Check, Share2, Download } from 'lucide-react';

/**
 * The symmetric counterpart to Send.tsx: shows this user's own ScanLinkPay
 * wallet number as a QR (scanned by ScanQr.tsx, which routes a recognized
 * wallet number into Send.tsx pre-filled) plus the number itself for
 * manual entry — same "scan, or type the code" pattern already used for
 * merchant payment requests (see PaymentRequestShareCard.tsx).
 */
export default function ReceivePage() {
  const navigate = useNavigate();
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const { data: wallet, isLoading } = useQuery({
    queryKey: ['wallet'],
    queryFn: async () => (await api.get('/wallet')).data,
  });

  useEffect(() => {
    if (!wallet?.wallet_number) return;
    QRCode.toDataURL(wallet.wallet_number, { width: 320, margin: 2, color: { dark: '#0F172A', light: '#FFFFFF' } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [wallet?.wallet_number]);

  const copyNumber = () => {
    if (!wallet?.wallet_number) return;
    navigator.clipboard.writeText(wallet.wallet_number);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // The WebView Capacitor runs the Android app in doesn't reliably support
  // `<a download>` on a data: URL (no download manager hooked up — the tap
  // just does nothing), and doesn't implement navigator.share either. Both
  // buttons need the native file/share bridge instead; writing the PNG to
  // the cache dir once and handing its file:// URI to @capacitor/share (via
  // the FileProvider already declared in AndroidManifest.xml) works on both
  // native platforms — it's what the plain web/PWA build keeps using the
  // existing <a download> / navigator.share path for below.
  const writeQrToCache = async () => {
    const base64 = qrDataUrl.split(',')[1];
    const { uri } = await Filesystem.writeFile({
      path: 'scanlinkpay-qr.png',
      data: base64,
      directory: Directory.Cache,
    });
    return uri;
  };

  const downloadQr = async () => {
    if (!qrDataUrl || !Capacitor.isNativePlatform()) return; // web build: the <a download> below handles it
    const uri = await writeQrToCache();
    await Share.share({ title: 'Mon QR ScanLinkPay', files: [uri], dialogTitle: 'Enregistrer le QR' });
  };

  const share = async () => {
    if (!wallet?.wallet_number) return;
    const text = `Envoyez-moi de l'argent sur ScanLinkPay avec mon numéro : ${wallet.wallet_number}`;

    if (Capacitor.isNativePlatform()) {
      // Native share sheet — reliable regardless of the WebView's
      // navigator.share support, and can attach the QR image directly.
      // No `url` here: window.location.origin inside the app is
      // "https://localhost" (Capacitor's internal bridge host), not a real
      // address — sharing it would hand the recipient a dead link.
      const files = qrDataUrl ? [await writeQrToCache()] : undefined;
      await Share.share({ title: 'Mon numéro ScanLinkPay', text, files });
      return;
    }

    const method = await shareOrCopy({
      title: 'Mon numéro ScanLinkPay',
      text,
      url: window.location.origin,
    });
    if (method === 'copy') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <FormSheet onClose={() => navigate(-1)} title="Recevoir de l'argent">
      <div className="p-6 max-w-md mx-auto text-center">
        <h2 className="text-xl font-bold text-foreground mb-1">Recevoir de l'argent</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Montrez ce QR ou communiquez votre numéro pour recevoir un virement
        </p>

        {isLoading ? (
          <div className="py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
          </div>
        ) : (
          <Card>
            <CardContent className="pt-6">
              {qrDataUrl && (
                <div className="flex justify-center mb-4">
                  <img src={qrDataUrl} alt="Mon QR ScanLinkPay" className="w-48 h-48 rounded-2xl border border-border" />
                </div>
              )}
              <div className="mb-4">
                <p className="text-xs text-muted-foreground mb-1">Votre numéro ScanLinkPay</p>
                <p className="font-mono text-xl font-bold tracking-wider text-foreground">{wallet?.wallet_number}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={copyNumber}>
                  {copied ? <Check className="mr-2 w-4 h-4 text-success" /> : <Copy className="mr-2 w-4 h-4" />}
                  Copier
                </Button>
                {Capacitor.isNativePlatform() ? (
                  <Button variant="outline" className="flex-1" onClick={downloadQr}>
                    <Download className="mr-2 w-4 h-4" />
                    QR
                  </Button>
                ) : (
                  <Button variant="outline" className="flex-1" asChild>
                    <a href={qrDataUrl} download="mon-qr-scanlinkpay.png">
                      <Download className="mr-2 w-4 h-4" />
                      QR
                    </a>
                  </Button>
                )}
              </div>
              <Button className="w-full mt-3" onClick={share}>
                <Share2 className="mr-2 w-4 h-4" />
                Partager
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </FormSheet>
  );
}
