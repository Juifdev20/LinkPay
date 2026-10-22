import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { formatDate, countLabel } from '@/lib/utils';
import { Check, X, Loader2, Search, Store } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/EmptyState';

const STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'error' }> = {
  pending: { label: 'À valider', variant: 'warning' },
  active: { label: 'Actif', variant: 'success' },
  rejected: { label: 'Refusé', variant: 'error' },
  suspended: { label: 'Suspendu', variant: 'error' },
};

export default function AdminMerchantsPage() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['admin-merchants'],
    queryFn: async () => {
      const { data } = await api.get('/admin/merchants');
      return data;
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.put(`/admin/merchants/${id}/status`, { status: 'active' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-merchants'] }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.put(`/admin/merchants/${id}/status`, { status: 'rejected' });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-merchants'] }),
  });

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const rows: any[] = (data?.data || []).filter((m: any) => {
    if (statusFilter && m.status !== statusFilter) return false;
    const q = query.trim().toLowerCase();
    return !q || [m.name, m.email, m.phone, m.scanlinkpay_number].filter(Boolean).some((v: string) => v.toLowerCase().includes(q));
  });
  const pendingCount = (data?.data || []).filter((m: any) => m.status === 'pending').length;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <PageHeader title="Commerçants" />

      <Card>
        <CardHeader className="flex flex-col gap-3 space-y-0 md:flex-row md:items-center md:justify-between">
          <CardTitle className="text-base font-bold">
            {countLabel(data?.data?.length || 0, 'commerçant')}
            {pendingCount > 0 && <span className="ml-2 text-sm font-medium text-warning">· {pendingCount} à valider</span>}
          </CardTitle>
          <div className="flex gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="h-10 w-full pl-9 md:w-64" placeholder="Nom, email, téléphone…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <Select className="h-10 w-44" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Statut">
              <option value="">Tous les statuts</option>
              {Object.entries(STATUS).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {rows.length ? (
            <div className="-mx-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-xs text-muted-foreground">
                  <tr>
                    <th className="px-6 py-2.5 text-left font-medium">Commerçant</th>
                    <th className="px-3 py-2.5 text-left font-medium">Contact</th>
                    <th className="px-3 py-2.5 text-left font-medium">Inscrit le</th>
                    <th className="px-3 py-2.5 text-left font-medium">Statut</th>
                    <th className="px-6 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((m: any) => {
                    const st = STATUS[m.status] ?? { label: m.status, variant: 'warning' as const };
                    return (
                      <tr key={m.id} className="hover:bg-accent/40">
                        <td className="px-6 py-3 font-semibold text-foreground">{m.name}</td>
                        <td className="px-3 py-3 text-muted-foreground">{[m.email, m.phone].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{formatDate(m.created_at)}</td>
                        <td className="px-3 py-3"><Badge variant={st.variant}>{st.label}</Badge></td>
                        <td className="px-6 py-3">
                          {m.status === 'pending' && (
                            <div className="flex justify-end gap-2">
                              <Button size="sm" disabled={approveMutation.isPending} onClick={() => approveMutation.mutate(m.id)}>
                                {approveMutation.isPending && approveMutation.variables === m.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                                Valider
                              </Button>
                              <Button size="sm" variant="outline" className="text-destructive" disabled={rejectMutation.isPending} onClick={() => rejectMutation.mutate(m.id)}>
                                {rejectMutation.isPending && rejectMutation.variables === m.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <X className="mr-1.5 h-4 w-4" />}
                                Refuser
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={Store}
              title={data?.data?.length ? 'Aucun commerçant ne correspond' : 'Aucun commerçant'}
              text={data?.data?.length ? 'Changez la recherche ou le statut.' : 'Les commerçants inscrits apparaîtront ici, à valider.'}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
