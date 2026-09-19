import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/PageHeader';
import { formatCurrency } from '@/lib/utils';
import { Plus, Users, ChevronRight } from 'lucide-react';

const STATUS_LABEL: Record<string, string> = {
  forming: 'En formation',
  active: 'En cours',
  completed: 'Terminée',
  cancelled: 'Annulée',
};

export default function TontinesListPage() {
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ['tontines'],
    queryFn: async () => (await api.get('/tontines/mine')).data,
  });

  return (
    <div className="p-6 pb-28 md:pb-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader title="Tontines" action={{ label: 'Créer', icon: Plus, to: '/dashboard/tontines/new' }} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">Mes tontines</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.length ? (
            <div>
              {data.map((item: any) => (
                <button
                  key={item.group.id}
                  type="button"
                  onClick={() => navigate(`/dashboard/tontines/${item.group.id}`)}
                  className="w-full flex flex-col gap-1 py-3 border-b border-border last:border-0 text-left hover:bg-accent/50 transition-colors -mx-2 px-2 rounded-lg"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold truncate text-foreground min-w-0 flex-1">{item.group.name}</p>
                    <span className="font-bold text-foreground flex-shrink-0">
                      {formatCurrency(item.group.contribution_amount_cents, item.group.currency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-muted-foreground truncate min-w-0 flex-1">
                      {item.group.frequency === 'weekly' ? 'Hebdomadaire' : 'Mensuelle'}
                      {item.my_payout_position ? ` · Mon tour : n°${item.my_payout_position}` : ''}
                    </p>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge variant={item.group.status === 'active' ? 'success' : item.group.status === 'completed' ? 'error' : 'warning'}>
                        {STATUS_LABEL[item.group.status] || item.group.status}
                      </Badge>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-10">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <Users className="w-7 h-7 text-primary" />
              </div>
              <p className="text-muted-foreground mb-1">Aucune tontine pour le moment</p>
              <p className="text-sm text-muted-foreground">Créez-en une pour épargner en groupe avec vos proches</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
