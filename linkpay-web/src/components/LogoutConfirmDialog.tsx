import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/** Shared by every "Déconnexion" entry point (desktop sidebar, mobile
 * Profile page) so logging out always asks for confirmation first instead
 * of firing immediately on a single misplaced tap. */
export function LogoutConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Se déconnecter ?</DialogTitle>
          <DialogDescription>Vous devrez vous reconnecter pour accéder à votre compte.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Se déconnecter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
