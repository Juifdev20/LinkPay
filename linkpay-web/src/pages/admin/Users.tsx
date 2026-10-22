import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatDate, countLabel } from '@/lib/utils';
import { Loader2, KeyRound, ShieldOff, ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { ROLE_LABELS } from '@/lib/permissions';
import { EmptyState } from '@/components/EmptyState';
import { Select } from '@/components/ui/select';

const ROLES = ['client', 'cashier', 'merchant', 'enterprise', 'admin', 'super_admin'];
/** « Marchand », « Super administrateur »… (the role names of the database stay out of the screen). */
const roleName = (r: string) => (r === 'enterprise' ? 'Entreprise (responsable)' : ROLE_LABELS[r] || r);
const PAGE_SIZE = 20;

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const [selectedRole, setSelectedRole] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [resetTarget, setResetTarget] = useState<any>(null);
  const [reset2faTarget, setReset2faTarget] = useState<any>(null);

  const { data } = useQuery({
    queryKey: ['admin-users', page],
    queryFn: async () => {
      const { data } = await api.get('/admin/users', { params: { page, limit: PAGE_SIZE } });
      return data;
    },
  });

  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / PAGE_SIZE));

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

  const reset2faMutation = useMutation({
    mutationFn: async (userId: string) => {
      await api.post(`/admin/users/${userId}/reset-2fa`);
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <PageHeader title="Utilisateurs" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">{countLabel(data?.total || 0, 'utilisateur')}</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.data?.length ? (
            <div className="-mx-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-xs text-muted-foreground">
                  <tr>
                    <th className="px-6 py-2.5 text-left font-medium">Utilisateur</th>
                    <th className="px-3 py-2.5 text-left font-medium">Inscrit le</th>
                    <th className="px-3 py-2.5 text-left font-medium">Rôle</th>
                    <th className="px-3 py-2.5 text-left font-medium">Changer le rôle</th>
                    <th className="px-6 py-2.5 text-right font-medium">Sécurité</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.data.map((u: any) => {
                    const pendingRole = selectedRole[u.id] ?? u.role;
                    const isPending = assignMutation.isPending && assignMutation.variables?.userId === u.id;
                    return (
                      <tr key={u.id} className="hover:bg-accent/40">
                        <td className="max-w-[280px] px-6 py-3">
                          <p className="truncate font-semibold text-foreground">{u.full_name || u.email}</p>
                          <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{formatDate(u.created_at)}</td>
                        <td className="px-3 py-3"><Badge variant="secondary">{roleName(u.role)}</Badge></td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <Select
                              className="h-9 w-48 text-xs"
                              aria-label="Nouveau rôle"
                              value={pendingRole}
                              onChange={(e) => setSelectedRole({ ...selectedRole, [u.id]: e.target.value })}
                            >
                              {ROLES.map((r) => <option key={r} value={r}>{roleName(r)}</option>)}
                            </Select>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pendingRole === u.role || isPending}
                              onClick={() => assignMutation.mutate({ userId: u.id, role: pendingRole })}
                            >
                              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Appliquer'}
                            </Button>
                          </div>
                        </td>
                        <td className="px-6 py-3">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Réinitialiser la session (libère l'appareil connecté)"
                              disabled={resetSessionMutation.isPending && resetSessionMutation.variables === u.id}
                              onClick={() => setResetTarget(u)}
                            >
                              {resetSessionMutation.isPending && resetSessionMutation.variables === u.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                            </Button>
                            {['admin', 'super_admin'].includes(u.role) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Réinitialiser la double authentification (téléphone perdu)"
                                disabled={reset2faMutation.isPending && reset2faMutation.variables === u.id}
                                onClick={() => setReset2faTarget(u)}
                              >
                                <ShieldOff className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Users} title="Aucun utilisateur" />
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 border-t border-border">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="w-4 h-4 mr-1" />
                Précédent
              </Button>
              <p className="text-sm text-muted-foreground">
                Page {page} / {totalPages}
              </p>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Suivant
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!reset2faTarget}
        onOpenChange={(open) => !open && setReset2faTarget(null)}
        title="Réinitialiser la double authentification ?"
        description={`${reset2faTarget?.full_name || reset2faTarget?.email || ''} devra configurer à nouveau son application d'authentification à sa prochaine connexion. Les autres administrateurs seront alertés.`}
        confirmLabel="Réinitialiser"
        variant="destructive"
        onConfirm={() => reset2faMutation.mutate(reset2faTarget.id)}
      />

      <ConfirmDialog
        open={!!resetTarget}
        onOpenChange={(open) => !open && setResetTarget(null)}
        title="Réinitialiser la session ?"
        description={`L'appareil actuellement connecté au compte ${resetTarget?.full_name || resetTarget?.email || ''} sera déconnecté.`}
        confirmLabel="Réinitialiser"
        onConfirm={() => resetSessionMutation.mutate(resetTarget.id)}
      />
    </div>
  );
}
