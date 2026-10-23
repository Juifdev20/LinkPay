import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import QRCode from 'qrcode';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { isStaffRole } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormSheet } from '@/components/FormSheet';
import { shareOrCopy, publicOrigin } from '@/lib/share';
import { cn } from '@/lib/utils';
import { Loader2, Copy, Check, Share2, Download } from 'lucide-react';

type Target = { key: string; label: string; payTo: string; number: string };

/**
 * "Recevoir un paiement": the QR / ScanLinkPay number a customer pays with.
 * An employee shows their OWN station's — the payment is then always booked
 * to the station that took it. The owner picks the whole business (the
 * customer then chooses the station) or one station. Either way the money
 * lands in the business's wallet (the owner's), never in the employee's.
 * The QR is drawn here from the number, so every station has one.
 */
export default function OrganizationReceivePage() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isStaff = isStaffRole(user?.role);
  const [copied, setCopied] = useState(false);
  const [picked, setPicked] = useState<string>('org');
  const [qr, setQr] = useState('');

  const { data: org, isLoading } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
  });
  // Staff only get their own station back.
  const { data: stations, isLoading: stationsLoading } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data as { id: string; name: string; scanlinkpay_number?: string }[],
    enabled: !!org?.id,
  });

  const stationTargets: Target[] = (stations || [])
    .filter((s) => s.scanlinkpay_number)
    .map((s) => ({ key: s.id, label: s.name, payTo: `${org?.name} · ${s.name}`, number: s.scanlinkpay_number! }));
  const orgTarget: Target | null = org?.scanlinkpay_number
    ? { key: 'org', label: "Toute l'entreprise", payTo: org.name, number: org.scanlinkpay_number }
    : null;
  const targets = isStaff ? stationTargets.slice(0, 1) : [...(orgTarget ? [orgTarget] : []), ...stationTargets];
  const target = targets.find((t) => t.key === picked) || targets[0];
  const payUrl = target ? `${publicOrigin()}/pay/${target.number}` : '';

  useEffect(() => {
    if (!payUrl) { setQr(''); return; }
    QRCode.toDataURL(payUrl, { width: 400, margin: 1 }).then(setQr).catch(() => setQr(''));
  }, [payUrl]);

  const copyNumber = () => {
    if (!target) return;
    navigator.clipboard.writeText(target.number);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // The WebView doesn't reliably support <a download> or navigator.share with
  // files, so native platforms write the QR to the cache and use Capacitor's Share.
  const qrToCache = async () => {
    const { uri } = await Filesystem.writeFile({
      path: `scanlinkpay-qr-${target!.number}.png`,
      data: qr.split(',')[1],
      directory: Directory.Cache,
    });
    return uri;
  };

  const downloadQr = async () => {
    if (!qr || !Capacitor.isNativePlatform()) return;
    await Share.share({ title: 'QR ScanLinkPay', files: [await qrToCache()], dialogTitle: 'Enregistrer le QR' });
  };

  const share = async () => {
    if (!target) return;
    const text = `Payez ${target.payTo} via ScanLinkPay avec le numéro : ${target.number}`;
    if (Capacitor.isNativePlatform()) {
      await Share.share({ title: `Payer ${target.payTo}`, text, files: qr ? [await qrToCache()] : undefined });
      return;
    }
    const method = await shareOrCopy({ title: `Payer ${target.payTo}`, text, url: payUrl });
    if (method === 'copy') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const loading = isLoading || (!!org?.id && stationsLoading);

  return (
    <FormSheet onClose={() => navigate(-1)} title="Recevoir un paiement">
      <div className="p-6 max-w-md mx-auto text-center">
        <h2 className="text-xl font-bold text-foreground mb-1">Recevoir un paiement</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Montrez ce QR ou communiquez le numéro pour encaisser une vente
        </p>

        {/* The owner chooses what to show; an employee always shows their station. */}
        {!isStaff && targets.length > 1 && (
          <div className="-mx-6 mb-4 overflow-x-auto px-6">
            <div className="flex w-max gap-2">
              {targets.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setPicked(t.key)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm font-medium',
                    target?.key === t.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-16">
            <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
          </div>
        ) : !target ? (
          <p className="text-sm text-muted-foreground py-16">
            {isStaff
              ? "Aucune station ne vous est affectée : demandez au responsable de l'entreprise."
              : "Le numéro ScanLinkPay de l'entreprise n'est pas encore disponible."}
          </p>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm font-semibold text-foreground mb-3">{target.payTo}</p>
              {qr && (
                <div className="flex justify-center mb-4">
                  <img src={qr} alt={`QR ScanLinkPay — ${target.payTo}`} className="w-48 h-48 rounded-2xl border border-border bg-white p-2" />
                </div>
              )}
              <div className="mb-4">
                <p className="text-xs text-muted-foreground mb-1">
                  {target.key === 'org' ? "Numéro ScanLinkPay de l'entreprise (le client choisit la station)" : 'Numéro ScanLinkPay de la station'}
                </p>
                <p className="font-mono text-xl font-bold tracking-wider text-foreground">{target.number}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={copyNumber}>
                  {copied ? <Check className="mr-2 w-4 h-4 text-success" /> : <Copy className="mr-2 w-4 h-4" />}
                  Copier
                </Button>
                {Capacitor.isNativePlatform() ? (
                  <Button variant="outline" className="flex-1" onClick={downloadQr} disabled={!qr}>
                    <Download className="mr-2 w-4 h-4" />
                    QR
                  </Button>
                ) : (
                  <Button variant="outline" className="flex-1" asChild>
                    <a href={qr} download={`qr-scanlinkpay-${target.number}.png`}>
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
