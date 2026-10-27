import { useEffect, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import api from '@/lib/api';
import { announceStock, beepOk, getSoundPrefs, say, setSoundPrefs } from '@/lib/sound';

/**
 * Settings → "Sons et voix": the scan beep, the recorded female voice, and the stock alerts. The beep and the voice follow the phone's
 * media volume. A stock alert repeats every 24 h while an article is still low, until it is refilled — or until the user turns it off here
 * (or on the notification itself, for one article only).
 */
export function SoundSettings({ showStockAlerts }: { showStockAlerts: boolean }) {
  const [prefs, setPrefs] = useState(getSoundPrefs());
  const [stockMuted, setStockMuted] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!showStockAlerts) return;
    api.get('/stock-alerts/mutes').then(({ data }) => setStockMuted(!!data?.all)).catch(() => undefined);
  }, [showStockAlerts]);

  const update = (p: Partial<typeof prefs>) => {
    setSoundPrefs(p);
    setPrefs(getSoundPrefs());
  };

  const toggleStock = async (on: boolean) => {
    setBusy(true);
    try {
      if (on) await api.delete('/stock-alerts/mutes');
      else await api.put('/stock-alerts/mutes', {});
      setStockMuted(!on);
    } catch {
      /* unchanged: the switch stays where it was */
    } finally {
      setBusy(false);
    }
  };

  const row = 'flex items-center gap-3 w-full px-6 py-3.5 border-b border-border';
  return (
    <>
      <div className={row}>
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-500"><Volume2 className="h-[18px] w-[18px]" /></span>
        <div className="flex-1">
          <p className="font-medium text-sm text-foreground">Bip de scan</p>
          <p className="text-xs text-muted-foreground">Un bip à chaque produit ou QR code lu, suivant le volume de votre téléphone.</p>
        </div>
        <Switch checked={prefs.beep} onCheckedChange={(v) => { update({ beep: v }); if (v) setTimeout(beepOk, 50); }} />
      </div>
      <div className={row}>
        <div className="w-9 flex-shrink-0" />
        <div className="flex-1">
          <p className="font-medium text-sm text-foreground">Voix</p>
          <p className="text-xs text-muted-foreground">
            Une voix de femme annonce « Please try again », « Paiement reçu », « Solde insuffisant », « Stock bas »…{' '}
            <button type="button" className="text-primary underline" onClick={() => { setSoundPrefs({ voice: true }); say('please-try-again'); }}>Écouter un exemple</button>
          </p>
        </div>
        <Switch checked={prefs.voice} onCheckedChange={(v) => { update({ voice: v }); if (v) setTimeout(() => say('paiement-recu'), 50); }} />
      </div>
      {showStockAlerts && (
        <div className={row}>
          <div className="w-9 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-sm text-foreground">Alertes de stock</p>
            <p className="text-xs text-muted-foreground">
              {stockMuted
                ? 'Coupées : vous n\'êtes plus prévenu des stocks bas.'
                : "« Stock bas » est annoncé, puis rappelé toutes les 24 h tant que le stock n'est pas rechargé, même application fermée."}{' '}
              {!stockMuted && (
                <button type="button" className="text-primary underline" onClick={() => announceStock('Coca 33 cl', false)}>Écouter un exemple</button>
              )}
            </p>
          </div>
          <Switch checked={!stockMuted} disabled={busy} onCheckedChange={toggleStock} />
        </div>
      )}
    </>
  );
}
