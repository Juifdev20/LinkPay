import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { formatCurrency } from '@/lib/utils';
import { Users, Store, TrendingUp, Receipt } from 'lucide-react';

export default function AdminDashboard() {
  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const { data } = await api.get('/admin/dashboard');
      return data;
    },
  });

  const cards = [
    { label: 'Volume total', value: formatCurrency(stats?.total_volume_cents || 0), icon: TrendingUp },
    { label: 'Transactions', value: String(stats?.total_transactions || 0), icon: Receipt },
    { label: 'Commercants', value: String(stats?.total_merchants || 0), icon: Store },
    { label: 'Utilisateurs', value: String(stats?.total_users || 0), icon: Users },
  ];

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader title="Administration" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="pt-5">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                <c.icon className="w-5 h-5 text-primary" />
              </div>
              <p className="text-xl font-bold text-foreground">{c.value}</p>
              <p className="text-sm text-muted-foreground">{c.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-bold">Commerçants en attente</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-warning">{stats?.pending_merchants || 0}</p>
            <p className="text-sm text-muted-foreground">En attente d'approbation</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-bold">Commissions perçues</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold text-primary">{formatCurrency(stats?.total_commission_cents || 0)}</p>
            <p className="text-sm text-muted-foreground">Total plateforme</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
