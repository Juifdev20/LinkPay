import { useDeviceUntrusted } from '@/lib/client-platform';
import { useAppLock } from '@/lib/app-lock-store';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ShieldAlert } from 'lucide-react';

/** Mounted once in App.tsx — shown when the API refuses a transfer or withdrawal because this phone isn't trustworthy. */
export function DeviceUntrustedDialog() {
  const { open, message, close } = useDeviceUntrusted();
  const locked = useAppLock((s) => s.locked);

  return (
    // Not over the access-code screen: the dialog would steal its focus. It shows right after unlocking.
    <Dialog open={open && !locked} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-destructive" /> Appareil non sécurisé</DialogTitle>
          <DialogDescription>
            {message || "Cet appareil n'est pas sécurisé (rooté, émulé ou application modifiée). Les retraits et les transferts sont désactivés ici pour protéger votre argent."}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Vous pouvez toujours consulter votre compte. Pour envoyer ou retirer de l'argent, utilisez un téléphone non modifié avec l'application installée depuis Google Play.
        </p>
        <Button className="w-full mt-2" onClick={close}>J'ai compris</Button>
      </DialogContent>
    </Dialog>
  );
}
