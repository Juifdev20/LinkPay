import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { useRealtimeInvalidate } from '@/hooks/useRealtimeInvalidate';
import { formatDate, cn } from '@/lib/utils';
import { Bell, CheckCheck } from 'lucide-react';

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);

  const { data: unread } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: async () => {
      const { data } = await api.get('/notifications/unread-count');
      return data;
    },
    // Realtime (below) pushes updates instantly when available; this stays
    // as a fallback so the badge is still correct if the socket is down.
    refetchInterval: 30000,
  });

  useRealtimeInvalidate(
    'notifications',
    userId ? `user_id=eq.${userId}` : undefined,
    [['notifications'], ['notifications-unread-count']],
    !!userId,
  );

  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const { data } = await api.get('/notifications');
      return data;
    },
    enabled: open,
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.put(`/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await api.put('/notifications/read-all');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });

  const unreadCount = unread?.unread_count || 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative w-10 h-10 rounded-xl hover:bg-accent flex items-center justify-center transition-colors"
      >
        <Bell className="w-5 h-5 text-muted-foreground" />
        {unreadCount > 0 && (
          <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-destructive" />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-12 z-50 w-80 max-w-[90vw] rounded-2xl border border-border bg-card shadow-card-hover overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <p className="font-bold text-sm text-foreground">Notifications</p>
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllReadMutation.mutate()}
                  className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Tout marquer comme lu
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {notifications?.length ? (
                notifications.map((n: any) => (
                  <button
                    key={n.id}
                    onClick={() => !n.read && markAsReadMutation.mutate(n.id)}
                    className={cn(
                      'flex flex-col gap-0.5 w-full px-4 py-3 text-left border-b border-border last:border-0 hover:bg-accent transition-colors',
                      !n.read && 'bg-primary/5',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
                      <p className="font-semibold text-sm text-foreground truncate">{n.title}</p>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{n.body}</p>
                    <p className="text-[10px] text-muted-foreground">{formatDate(n.created_at)}</p>
                  </button>
                ))
              ) : (
                <p className="text-center text-sm text-muted-foreground py-8">Aucune notification</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
