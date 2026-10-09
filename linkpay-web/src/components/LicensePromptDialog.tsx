import { useNavigate } from 'react-router-dom';
import { useLicensePrompt } from '@/lib/license-prompt';
import { useAuthStore } from '@/lib/auth-store';
import { useAppLock } from '@/lib/app-lock-store';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { KeyRound } from 'lucide-react';

/** Mounted once in App.tsx — shown when the API refuses an action for lack of a licence. */
export function LicensePromptDialog() {
  const { open, info, close } = useLicensePrompt();
  const navigate = useNavigate();
  const locked = useAppLock((s) => s.locked);
  const user = useAuthStore((s) => s.user);
  const isOwner = user?.role === 'enterprise' || !!user?.acting_as_org_id;

  // Not while the access-code screen is up: the dialog would steal its focus. It shows right after unlocking.
  return (
    <Dialog open={open && !locked} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="w-5 h-5 text-primary" /> Licence requise</DialogTitle>
          <DialogDescription>
            {info?.message || "Vous n'avez pas de licence pour cette fonctionnalité."}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {isOwner
            ? 'Achetez-la depuis votre portefeuille ScanLinkPay : choisissez les fonctionnalités et le nombre de jours, l\'accès reprend aussitôt.'
            : 'Demandez au patron d\'acheter cette licence : votre accès reprendra dès qu\'elle sera payée.'}
        </p>
        <div className="flex gap-2 mt-2">
          <Button variant="outline" className="flex-1" onClick={close}>Plus tard</Button>
          {isOwner && (
            <Button
              className="flex-1"
              onClick={() => {
                close();
                navigate(`/dashboard/organization/license${info?.feature ? `?feature=${info.feature}` : ''}`);
              }}
            >
              Acheter une licence
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
