import { useState } from 'react';
import { useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { formatDate, cn } from '@/lib/utils';
import { CheckCheck, Trash2, Loader2 } from 'lucide-react';
import { NotificationDetailDialog } from '@/components/NotificationDetailDialog';

const PAGE_SIZE = 20;

/**
 * Full notification archive — the bell dropdown only ever shows the first
 * page (see NotificationsBell.tsx), since nothing is ever auto-deleted or
 * expired, anything beyond that needs pagination to stay reachable. The
 * only way a notification ever leaves this list is the user deleting it
 * themselves (no bulk/automatic cleanup anywhere).
 */
export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<any>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['notifications-history'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
  };

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['notifications-history'],
    queryFn: async ({ pageParam = 1 }) => {
      const { data } = await api.get('/notifications', { params: { page: pageParam, limit: PAGE_SIZE } });
      return { items: data as any[], page: pageParam };
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.items.length === PAGE_SIZE ? lastPage.page + 1 : undefined),
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (id: string) => api.put(`/notifications/${id}/read`),
    onSuccess: invalidate,
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => api.put('/notifications/read-all'),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      setDeletingId(id);
      await api.delete(`/notifications/${id}`);
    },
    onSuccess: invalidate,
    onSettled: () => setDeletingId(null),
  });

  const notifications = data?.pages.flatMap((p) => p.items) || [];

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <PageHeader title="Notifications" />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Historique complet</CardTitle>
          <Button variant="outline" size="sm" onClick={() => markAllReadMutation.mutate()} disabled={markAllReadMutation.isPending}>
            <CheckCheck className="mr-1 w-4 h-4" />
            Tout marquer comme lu
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : notifications.length ? (
            <div>
              {notifications.map((n: any) => (
                <div
                  key={n.id}
                  className={cn(
                    'flex items-start gap-3 py-3 border-b border-border last:border-0',
                    !n.read && 'bg-primary/5 -mx-2 px-2 rounded-lg',
                  )}
                >
                  <button
                    className="flex-1 min-w-0 text-left"
                    onClick={() => {
                      setSelected(n);
                      if (!n.read) markAsReadMutation.mutate(n.id);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
                      <p className="font-semibold text-sm text-foreground">{n.title}</p>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{n.body}</p>
                    <p className="text-xs text-muted-foreground mt-1">{formatDate(n.created_at)}</p>
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(n.id)}
                    disabled={deletingId === n.id}
                    className="flex-shrink-0 p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    aria-label="Supprimer"
                  >
                    {deletingId === n.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  </button>
                </div>
              ))}

              {hasNextPage && (
                <Button
                  variant="outline"
                  className="w-full mt-4"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                  Charger plus
                </Button>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">Aucune notification</p>
          )}
        </CardContent>
      </Card>

      <NotificationDetailDialog notification={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
