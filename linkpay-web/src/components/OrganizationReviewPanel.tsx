import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, X, Loader2 } from 'lucide-react';

/**
 * The enterprise KYB review surface — shared by the admin organizations
 * list (`admin/Organizations.tsx`) and the "Nouvelle entreprise à valider"
 * notification detail (`NotificationDetailDialog.tsx`), so a super admin
 * sees the exact same information and Valider/Rejeter actions regardless
 * of which surface they opened it from. `onDone` fires after a successful
 * validate/reject so each consumer can close/invalidate as appropriate.
 */
export function OrganizationReviewPanel({ org, onDone }: { org: any; onDone?: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  const validateMutation = useMutation({
    mutationFn: async () => api.post(`/organizations/${org.id}/validate`),
    onSuccess: () => onDone?.(),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => api.post(`/organizations/${org.id}/reject`, { reason }),
    onSuccess: () => {
      setRejecting(false);
      setReason('');
      onDone?.();
    },
  });

  return (
    <div className="space-y-3">
      <div className="space-y-1 text-sm rounded-xl border border-border p-4">
        <p><span className="text-muted-foreground">Forme juridique : </span>{org.legal_form || '—'}</p>
        <p><span className="text-muted-foreground">Adresse : </span>{[org.contact?.address?.avenue, org.contact?.address?.commune, org.contact?.address?.city, org.contact?.address?.country].filter(Boolean).join(', ') || '—'}</p>
        <p><span className="text-muted-foreground">Secteur : </span>{org.sector || '—'}</p>
        <p><span className="text-muted-foreground">Devise : </span>{org.currency || '—'}</p>
      </div>

      {org.status === 'pending' && (
        <>
          <div className="flex gap-2">
            <Button className="flex-1" disabled={validateMutation.isPending} onClick={() => validateMutation.mutate()}>
              {validateMutation.isPending ? <Loader2 className="mr-2 w-4 h-4 animate-spin" /> : <Check className="mr-1 w-4 h-4" />}
              Valider
            </Button>
            <Button
              variant="outline"
              className="flex-1 text-destructive hover:text-destructive"
              onClick={() => setRejecting(!rejecting)}
            >
              <X className="mr-1 w-4 h-4" />
              Rejeter
            </Button>
          </div>
          {rejecting && (
            <div className="flex gap-2">
              <Input placeholder="Motif du rejet" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button
                variant="destructive"
                disabled={!reason || rejectMutation.isPending}
                onClick={() => rejectMutation.mutate()}
              >
                {rejectMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                Confirmer
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
