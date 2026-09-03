import { useEffect, useState } from 'react';
import { X, Download, Share2, Smartphone, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';

type InstallPromptType = 'none' | 'pwa' | 'ios';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export default function InstallPrompt() {
  const [type, setType] = useState<InstallPromptType>('none');
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // @ts-expect-error iOS property
      window.navigator.standalone === true;

    if (isStandalone || dismissed) return;

    const stored = localStorage.getItem('installPromptDismissed');
    if (stored === '1') return;

    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.userAgent.includes('Mac') && 'ontouchend' in document);
    const isSafari =
      /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);

    if (isIOS && isSafari) {
      setType('ios');
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setType('pwa');
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [dismissed]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setType('none');
    }
  };

  const handleDismiss = () => {
    setType('none');
    setDismissed(true);
    localStorage.setItem('installPromptDismissed', '1');
  };

  if (type === 'none') return null;

  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const Icon = isMobile ? Smartphone : Monitor;

  if (type === 'ios') {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-2xl border border-blue-200 bg-white p-4 shadow-lg">
        <div className="mb-3 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
              <Icon className="h-6 w-6" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Ajoutez LinkPay à votre écran</h3>
              <p className="text-xs text-slate-500">Accédez à LinkPay comme une app native</p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="rounded p-1 text-slate-400 hover:bg-slate-100"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <ol className="mb-3 space-y-2 text-sm text-slate-700">
          <li className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-blue-600" />
            Appuyez sur <strong>Partager</strong> dans la barre Safari
          </li>
          <li className="flex items-center gap-2">
            <Download className="h-4 w-4 text-blue-600" />
            Choisissez <strong>Sur l'écran d'accueil</strong>
          </li>
        </ol>
        <Button onClick={handleDismiss} className="w-full bg-blue-600 hover:bg-blue-700" size="sm">
          J'ai compris
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-2xl border border-blue-200 bg-white p-4 shadow-lg">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <img
            src="/pwa-192x192.png"
            alt="LinkPay"
            className="h-12 w-12 rounded-xl shadow-sm"
          />
          <div>
            <h3 className="font-semibold text-slate-900">Installez LinkPay</h3>
            <p className="text-xs text-slate-500">
              {isMobile
                ? 'Payez. Recevez. Simplement. Depuis votre appareil.'
                : 'Lancez LinkPay depuis votre bureau.'}
            </p>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="rounded p-1 text-slate-400 hover:bg-slate-100"
          aria-label="Fermer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex gap-2">
        <Button onClick={handleInstall} className="flex-1 bg-blue-600 hover:bg-blue-700" size="sm">
          <Download className="mr-2 h-4 w-4" />
          {isMobile ? "Ajouter à l'accueil" : 'Installer'}
        </Button>
        <Button onClick={handleDismiss} variant="outline" size="sm" className="flex-1">
          Plus tard
        </Button>
      </div>
    </div>
  );
}
