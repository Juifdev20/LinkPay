import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { OrganizationReviewPanel } from '@/components/OrganizationReviewPanel';
import { formatDate } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  created_at: string;
  data?: { organization_id?: string };
}

/**
 * The "open and read" surface for a notification — the bell dropdown and
 * the full /dashboard/notifications page both show a one/two-line preview
 * (truncated body in the bell), so clicking a row opens this instead of
 * just silently marking it read: full title, full untruncated body, and
 * the date, in the app's existing centered Dialog shell.
 *
 * Special case for the super admin's `org_submitted` notification: instead
 * of just the generic text, it fetches the full organization and shows the
 * same KYB review surface as `admin/Organizations.tsx`
 * (`OrganizationReviewPanel`) with Valider/Rejeter right here — the admin
 * doesn't have to separately go find the organization in the admin list.
 */
export function NotificationDetailDialog({ notification, onClose }: { notification: NotificationItem | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const orgId = notification?.type === 'org_submitted' ? notification.data?.organization_id : undefined;

  const { data: org, isLoading } = useQuery({
    queryKey: ['org-detail', orgId],
    queryFn: async () => (await api.get(`/organizations/${orgId}`)).data,
    enabled: !!orgId,
  });

  const handleReviewDone = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-organizations'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['notifications-history'] });
    onClose();
  };

  return (
    <Dialog open={!!notification} onOpenChange={(open) => !open && onClose()}>
      {notification && (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{notification.title}</DialogTitle>
          </DialogHeader>

          {orgId ? (
            isLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : org ? (
              <>
                <p className="font-semibold text-foreground mb-3">{org.name}</p>
                <OrganizationReviewPanel org={org} onDone={handleReviewDone} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{notification.body}</p>
            )
          ) : (
            <p className="text-sm text-foreground whitespace-pre-wrap">{notification.body}</p>
          )}

          <p className="text-xs text-muted-foreground mt-4">{formatDate(notification.created_at)}</p>
        </DialogContent>
      )}
    </Dialog>
  );
}
