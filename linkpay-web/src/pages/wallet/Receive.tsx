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
import { shareOrCopy, publicOrigin } from '@/lib/share';
import { useAuthStore } from '@/lib/auth-store';
import { Loader2, Copy, Check, Share2, Download } from 'lucide-react';

/**
 * The symmetric counterpart to Send.tsx — shows this account's payable code
 * (scanned by ScanQr.tsx or typed manually):
 *  - client: their personal wallet number (SLP-CLI-…), paid via a wallet
 *    transfer.
 *  - merchant: their business ScanLinkPay number (SLP-…, migration 061),
 *    encoded as the public /pay/{number} link — the customer pays through
 *    the real payment-request flow (quick-pay), so the sale counts in the
 *    store's stats and the commission applies, exactly like paying an
 *    organization. The plain wallet transfer number deliberately isn't
 *    shown here anymore: it skipped all of that.
 */
export default function ReceivePage() {
  const navigate = useNavigate();
  const merchantId = useAuthStore((s) => s.user?.merchant_id);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const { data: wallet, isLoading: walletLoading } = useQuery({
    queryKey: ['wallet'],
    queryFn: async () => (await api.get('/wallet')).data,
  });

  const { data: merchant, isLoading: merchantLoading } = useQuery({
    queryKey: ['merchant-me'],
    queryFn: async () => (await api.get('/merchants/me')).data,
    enabled: !!merchantId,
  });

  const isMerchant = !!merchantId;
  // Merchants get the business number; if migration 061 hasn't run yet the
  // column is absent and the wallet number keeps the screen usable.
  const businessNumber = merchant?.scanlinkpay_number;
  const number = businessNumber || wallet?.wallet_number;
  // The QR carries the full /pay/… URL for a business number (same content
  // as the server-generated scanlinkpay_qr_url) and the bare number for a
  // personal wallet — each matches what ScanQr.tsx expects.
  const qrPayload = businessNumber ? `${publicOrigin()}/pay/${businessNumber}` : number;
  const isLoading = isMerchant ? merchantLoading || walletLoading : walletLoading;

  useEffect(() => {
    if (!qrPayload) return;
    QRCode.toDataURL(qrPayload, { width: 320, margin: 2, color: { dark: '#0F172A', light: '#FFFFFF' } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [qrPayload]);

  const copyNumber = () => {
    if (!number) return;
    navigator.clipboard.writeText(number);
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
    if (!number) return;
    const text = businessNumber
      ? `Payez ${merchant?.name || 'ma boutique'} via ScanLinkPay avec le numéro : ${number}`
      : `Envoyez-moi de l'argent sur ScanLinkPay avec mon numéro : ${number}`;

    if (Capacitor.isNativePlatform()) {
      // Native share sheet — reliable regardless of the WebView's
      // navigator.share support, and can attach the QR image directly.
      const files = qrDataUrl ? [await writeQrToCache()] : undefined;
      await Share.share({ title: 'Mon numéro ScanLinkPay', text, files });
      return;
    }

    const method = await shareOrCopy({
      title: 'Mon numéro ScanLinkPay',
      text,
      url: businessNumber ? `${publicOrigin()}/pay/${number}` : window.location.origin,
    });
    if (method === 'copy') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <FormSheet fullPage onClose={() => navigate(-1)} title={isMerchant ? 'Encaisser' : "Recevoir de l'argent"}>
      <div className="p-6 max-w-md mx-auto text-center">
        <h2 className="text-xl font-bold text-foreground mb-1">
          {isMerchant ? 'Encaisser un paiement' : "Recevoir de l'argent"}
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          {businessNumber
            ? 'Le client scanne ce QR ou saisit ce numéro, choisit le montant, et vous êtes payé — compté comme une vente'
            : 'Montrez ce QR ou communiquez votre numéro pour recevoir un paiement'}
        </p>

        {isLoading ? (
          <div className="py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
          </div>
        ) : !number ? (
          <p className="text-sm text-muted-foreground py-16">
            Votre numéro ScanLinkPay n'est pas encore disponible.
          </p>
        ) : (
          <Card>
            <CardContent className="pt-6">
              {qrDataUrl && (
                <div className="flex justify-center mb-4">
                  <img src={qrDataUrl} alt="Mon QR ScanLinkPay" className="w-48 h-48 rounded-2xl border border-border" />
                </div>
              )}
              <div className="mb-4">
                <p className="text-xs text-muted-foreground mb-1">
                  {businessNumber ? 'Numéro ScanLinkPay de votre boutique' : 'Votre numéro ScanLinkPay'}
                </p>
                <p className="font-mono text-xl font-bold tracking-wider text-foreground">{number}</p>
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
