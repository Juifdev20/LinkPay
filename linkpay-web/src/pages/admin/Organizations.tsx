import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { formatDate } from '@/lib/utils';
import { Check, X, Loader2, ChevronDown, ChevronUp } from 'lucide-react';

export default function AdminOrganizationsPage() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const { data } = useQuery({
    queryKey: ['admin-organizations'],
    queryFn: async () => (await api.get('/admin/organizations')).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-organizations'] });

  const validateMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/organizations/${id}/validate`),
    onSuccess: invalidate,
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/organizations/${id}/reject`, { reason }),
    onSuccess: () => {
      setRejectingId(null);
      setReason('');
      invalidate();
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader title="Entreprises" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">{data?.data?.length || 0} entreprise(s) en attente</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.data?.length ? (
            <div>
              {data.data.map((org: any) => (
                <div key={org.id} className="border-b border-border last:border-0 py-3">
                  <div className="flex items-center justify-between">
                    <button
                      className="flex items-center gap-2 text-left flex-1 min-w-0"
                      onClick={() => setExpandedId(expandedId === org.id ? null : org.id)}
                    >
                      {expandedId === org.id ? <ChevronUp className="w-4 h-4 flex-shrink-0 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 flex-shrink-0 text-muted-foreground" />}
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground truncate">{org.name}</p>
                        <p className="text-sm text-muted-foreground">{org.sector || '—'} · Soumis le {org.submitted_at ? formatDate(org.submitted_at) : '—'}</p>
                      </div>
                    </button>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <Badge variant={org.status === 'active' ? 'success' : org.status === 'rejected' ? 'error' : 'warning'}>
                        {org.status}
                      </Badge>
                      {org.status === 'pending' && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={validateMutation.isPending}
                            onClick={() => validateMutation.mutate(org.id)}
                          >
                            {validateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 text-success" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setRejectingId(rejectingId === org.id ? null : org.id)}
                          >
                            <X className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>

                  {expandedId === org.id && (
                    <div className="mt-3 ml-6 space-y-1 text-sm rounded-xl border border-border p-4">
                      <p><span className="text-muted-foreground">Forme juridique : </span>{org.legal_form || '—'}</p>
                      <p><span className="text-muted-foreground">Téléphone : </span>{org.contact?.phone || '—'}</p>
                      <p><span className="text-muted-foreground">Email : </span>{org.contact?.email || '—'}</p>
                      <p><span className="text-muted-foreground">Adresse : </span>{[org.contact?.address?.avenue, org.contact?.address?.commune, org.contact?.address?.city, org.contact?.address?.country].filter(Boolean).join(', ') || '—'}</p>
                      <p><span className="text-muted-foreground">Secteur : </span>{org.sector || '—'}</p>
                      <p><span className="text-muted-foreground">Devise : </span>{org.currency || '—'}</p>
                      <p><span className="text-muted-foreground">Moyen de règlement : </span>{org.payout_info?.mobile_money ? `Mobile Money (${org.payout_info.mobile_money.operator})` : '—'}</p>
                    </div>
                  )}

                  {rejectingId === org.id && (
                    <div className="mt-3 ml-6 flex gap-2">
                      <Input
                        placeholder="Motif du rejet"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                      <Button
                        variant="destructive"
                        disabled={!reason || rejectMutation.isPending}
                        onClick={() => rejectMutation.mutate({ id: org.id, reason })}
                      >
                        {rejectMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                        Rejeter
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-6">Aucune entreprise en attente</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
