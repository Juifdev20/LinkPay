import { useState } from 'react';
import { useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { formatDate, cn } from '@/lib/utils';
import { CheckCheck, Trash2, Loader2, ArrowDownLeft, ArrowUpFromLine, Bell, ShieldAlert, Sparkles, ShoppingCart, type LucideIcon } from 'lucide-react';

/** Coloured round icon by kind of notification, as in the design. */
function notificationLook(type?: string): { icon: LucideIcon; tone: string } {
  const t = String(type || '');
  if (/security|alert|lock|device/.test(t)) return { icon: ShieldAlert, tone: 'bg-rose-500' };
  if (/withdrawal/.test(t)) return { icon: ArrowUpFromLine, tone: 'bg-orange-500' };
  if (/payment|sale|invoice/.test(t)) return { icon: ShoppingCart, tone: 'bg-sky-500' };
  if (/transfer|topup|received|credit/.test(t)) return { icon: ArrowDownLeft, tone: 'bg-emerald-500' };
  if (/subscription|pro/.test(t)) return { icon: Sparkles, tone: 'bg-blue-700' };
  return { icon: Bell, tone: 'bg-blue-900' };
}
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
  const [tab, setTab] = useState<'all' | 'unread'>('all');

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

  const all = data?.pages.flatMap((p) => p.items) || [];
  const notifications = tab === 'unread' ? all.filter((n: any) => !n.read) : all;

  return (
    <div className="px-4 pt-2 pb-8 md:p-6 space-y-4 w-full max-w-4xl mx-auto">
      <PageHeader title="Notifications" />

      <div className="flex items-center gap-2">
        <div className="grid flex-1 grid-cols-2 gap-1 rounded-full bg-muted p-1">
          {([['all', 'Toutes'], ['unread', 'Non lues']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn('rounded-full py-2 text-xs font-semibold transition-all', tab === key ? 'bg-brand-gradient text-white shadow-brand' : 'text-muted-foreground')}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => markAllReadMutation.mutate()}
          disabled={markAllReadMutation.isPending}
          aria-label="Tout marquer comme lu"
          title="Tout marquer comme lu"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-primary"
        >
          <CheckCheck className="h-[18px] w-[18px]" />
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-card px-4 shadow-soft">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : notifications.length ? (
          <div className="divide-y divide-border">
            {notifications.map((n: any) => {
              const look = notificationLook(n.type);
              return (
                <div key={n.id} className="flex items-start gap-3 py-3.5">
                  <span className={cn('mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-white', look.tone)}>
                    <look.icon className="h-[18px] w-[18px]" />
                  </span>
                  <button
                    className="flex-1 min-w-0 text-left"
                    onClick={() => {
                      setSelected(n);
                      if (!n.read) markAsReadMutation.mutate(n.id);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <p className={cn('text-sm text-foreground truncate', n.read ? 'font-medium' : 'font-bold')}>{n.title}</p>
                      {!n.read && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-primary" />}
                    </div>
                    <p className="text-[13px] text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                    <p className="text-[11px] text-muted-foreground/80 mt-1">{formatDate(n.created_at)}</p>
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
              );
            })}

            {hasNextPage && (
              <div className="py-3">
                <Button variant="outline" className="w-full" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                  {isFetchingNextPage && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                  Charger plus
                </Button>
              </div>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-center py-10 text-sm">{tab === 'unread' ? 'Aucune notification non lue' : 'Aucune notification'}</p>
        )}
      </div>

      <NotificationDetailDialog notification={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
