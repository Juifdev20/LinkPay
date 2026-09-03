import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';
import { Loader2, KeyRound } from 'lucide-react';

const ROLES = ['client', 'cashier', 'merchant', 'enterprise', 'admin', 'super_admin'];

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [selectedRole, setSelectedRole] = useState<Record<string, string>>({});

  const { data } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const { data } = await api.get('/admin/users');
      return data;
    },
  });

  const assignMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      await api.post(`/admin/users/${userId}/role`, { role_slug: role });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const resetSessionMutation = useMutation({
    mutationFn: async (userId: string) => {
      await api.post(`/admin/users/${userId}/reset-session`);
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader title="Utilisateurs" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">{data?.total || 0} utilisateur(s)</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.data?.length ? (
            <div>
              {data.data.map((u: any) => {
                const pendingRole = selectedRole[u.id] ?? u.role;
                const isPending = assignMutation.isPending && assignMutation.variables?.userId === u.id;
                return (
                  <div key={u.id} className="flex items-center justify-between gap-3 py-3 border-b border-border last:border-0">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-foreground truncate">{u.full_name || u.email}</p>
                      <p className="text-xs text-muted-foreground truncate">{u.email} · {formatDate(u.created_at)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge variant="secondary" className="capitalize">{u.role}</Badge>
                      <select
                        className="rounded-lg border border-input bg-background px-2 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={pendingRole}
                        onChange={(e) => setSelectedRole({ ...selectedRole, [u.id]: e.target.value })}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pendingRole === u.role || isPending}
                        onClick={() => assignMutation.mutate({ userId: u.id, role: pendingRole })}
                      >
                        {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Assigner'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Réinitialiser la session (libère l'appareil connecté)"
                        disabled={resetSessionMutation.isPending && resetSessionMutation.variables === u.id}
                        onClick={() => resetSessionMutation.mutate(u.id)}
                      >
                        {resetSessionMutation.isPending && resetSessionMutation.variables === u.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <KeyRound className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-6">Aucun utilisateur</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
