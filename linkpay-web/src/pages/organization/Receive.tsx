import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormSheet } from '@/components/FormSheet';
import { shareOrCopy, publicOrigin } from '@/lib/share';
import { Loader2, Copy, Check, Share2, Download } from 'lucide-react';

/**
 * The enterprise counterpart to wallet/Receive.tsx — shows the
 * ORGANIZATION's fixed ScanLinkPay QR/number (not the owner's personal
 * wallet), so clients paying for a purchase scan/enter the business's own
 * code, same logic as a merchant's payment collection. The QR itself is
 * server-generated once at validation time (organizations.service.ts
 * ensureScanLinkPayQr) and just displayed here, unlike the personal wallet
 * page which generates its QR client-side on every visit.
 */
export default function OrganizationReceivePage() {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const { data: org, isLoading } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
  });

  const copyNumber = () => {
    if (!org?.scanlinkpay_number) return;
    navigator.clipboard.writeText(org.scanlinkpay_number);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Same native-share-bridge reasoning as wallet/Receive.tsx — the WebView
  // doesn't reliably support <a download> on a remote image URL or
  // navigator.share, so native platforms go through Capacitor's Share API.
  const downloadQrToCache = async () => {
    const resp = await fetch(org.scanlinkpay_qr_url);
    const blob = await resp.blob();
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const { uri } = await Filesystem.writeFile({
      path: 'scanlinkpay-qr-entreprise.png',
      data: base64,
      directory: Directory.Cache,
    });
    return uri;
  };

  const downloadQr = async () => {
    if (!org?.scanlinkpay_qr_url || !Capacitor.isNativePlatform()) return;
    const uri = await downloadQrToCache();
    await Share.share({ title: 'QR ScanLinkPay', files: [uri], dialogTitle: 'Enregistrer le QR' });
  };

  const share = async () => {
    if (!org?.scanlinkpay_number) return;
    const text = `Payez ${org.name} via ScanLinkPay avec le numéro : ${org.scanlinkpay_number}`;

    if (Capacitor.isNativePlatform()) {
      const files = org.scanlinkpay_qr_url ? [await downloadQrToCache()] : undefined;
      await Share.share({ title: `Payer ${org.name}`, text, files });
      return;
    }

    const method = await shareOrCopy({
      title: `Payer ${org.name}`,
      text,
      url: `${publicOrigin()}/pay/${org.scanlinkpay_number}`,
    });
    if (method === 'copy') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <FormSheet onClose={() => navigate(-1)} title="Recevoir un paiement">
      <div className="p-6 max-w-md mx-auto text-center">
        <h2 className="text-xl font-bold text-foreground mb-1">Recevoir un paiement</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Montrez ce QR ou communiquez le numéro pour encaisser une vente
        </p>

        {isLoading ? (
          <div className="py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
          </div>
        ) : !org?.scanlinkpay_number ? (
          <p className="text-sm text-muted-foreground py-16">
            Le numéro ScanLinkPay de l'entreprise n'est pas encore disponible.
          </p>
        ) : (
          <Card>
            <CardContent className="pt-6">
              {org.scanlinkpay_qr_url && (
                <div className="flex justify-center mb-4">
                  <img src={org.scanlinkpay_qr_url} alt="QR ScanLinkPay" className="w-48 h-48 rounded-2xl border border-border" />
                </div>
              )}
              <div className="mb-4">
                <p className="text-xs text-muted-foreground mb-1">Numéro ScanLinkPay de l'entreprise</p>
                <p className="font-mono text-xl font-bold tracking-wider text-foreground">{org.scanlinkpay_number}</p>
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
                    <a href={org.scanlinkpay_qr_url} download="qr-scanlinkpay-entreprise.png">
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
