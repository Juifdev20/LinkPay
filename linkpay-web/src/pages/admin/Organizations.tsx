import { EmptyState } from '@/components/EmptyState';
import { Building2 } from 'lucide-react';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { sectorLabel } from '@/lib/sectors';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/PageHeader';
import { OrganizationReviewPanel } from '@/components/OrganizationReviewPanel';
import { formatDate, countLabel } from '@/lib/utils';
import { ChevronDown, ChevronUp } from 'lucide-react';


const ORG_STATUS: Record<string, string> = { pending: 'À valider', active: 'Active', rejected: 'Refusée', draft: 'Brouillon', suspended: 'Suspendue' };
export default function AdminOrganizationsPage() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['admin-organizations'],
    queryFn: async () => (await api.get('/admin/organizations')).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-organizations'] });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <PageHeader title="Entreprises" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">{countLabel(data?.data?.length || 0, 'entreprise')} en attente</CardTitle>
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
                        <p className="text-sm text-muted-foreground">{sectorLabel(org.sector)} · Soumis le {org.submitted_at ? formatDate(org.submitted_at) : '—'}</p>
                      </div>
                    </button>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <Badge variant={org.status === 'active' ? 'success' : org.status === 'rejected' ? 'error' : 'warning'}>
                        {ORG_STATUS[org.status] ?? org.status}
                      </Badge>
                    </div>
                  </div>

                  {expandedId === org.id && (
                    <div className="mt-3 ml-6">
                      <OrganizationReviewPanel org={org} onDone={invalidate} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Building2} title="Aucune entreprise en attente" text="Les entreprises qui soumettent leur dossier apparaîtront ici, à valider." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
