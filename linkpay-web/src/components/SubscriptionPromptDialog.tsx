import { useNavigate } from 'react-router-dom';
import { useSubscriptionPrompt } from '@/lib/subscription-prompt';
import { useAuthStore } from '@/lib/auth-store';
import { useAppLock } from '@/lib/app-lock-store';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';

/** Mounted once in App.tsx — shown when the API refuses an action because the business has no active subscription. */
export function SubscriptionPromptDialog() {
  const { open, info, close } = useSubscriptionPrompt();
  const navigate = useNavigate();
  const locked = useAppLock((s) => s.locked);
  const user = useAuthStore((s) => s.user);
  const isOwner = user?.role === 'enterprise' || !!user?.acting_as_org_id;

  // Not while the access-code screen is up: the dialog would steal its focus. It shows right after unlocking.
  return (
    <Dialog open={open && !locked} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" /> Abonnement requis</DialogTitle>
          <DialogDescription>
            {info?.message || "Vous n'avez pas d'abonnement actif pour utiliser cette fonctionnalité."}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {isOwner
            ? "Abonnez-vous depuis votre portefeuille ScanLinkPay : tout est inclus, et l'accès reprend aussitôt."
            : "Demandez au patron de renouveler l'abonnement : votre accès reprendra dès qu'il sera payé."}
        </p>
        <div className="flex gap-2 mt-2">
          <Button variant="outline" className="flex-1" onClick={close}>Plus tard</Button>
          {isOwner && (
            <Button className="flex-1" onClick={() => { close(); navigate('/dashboard/organization/subscription'); }}>
              Voir l'abonnement
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
