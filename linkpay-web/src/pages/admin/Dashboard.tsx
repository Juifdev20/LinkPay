import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { DualCurrencyStat } from '@/components/DualCurrencyStat';
import { Users, Store, TrendingUp, Receipt, Wallet2 } from 'lucide-react';

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const { data } = await api.get('/admin/dashboard');
      return data;
    },
  });

  const cards = [
    { label: 'Volume total', money: stats?.volume, icon: TrendingUp },
    { label: 'Transactions', value: String(stats?.total_transactions || 0), icon: Receipt },
    { label: 'Commercants', value: String(stats?.total_merchants || 0), icon: Store },
    { label: 'Utilisateurs', value: String(stats?.total_users || 0), icon: Users },
  ];

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader title="Administration" />

      <button
        onClick={() => navigate('/dashboard/expenses')}
        className="w-full flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-left hover:bg-primary/10 transition-colors"
      >
        <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
          <Wallet2 className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground">Mes dépenses</p>
          <p className="text-sm text-muted-foreground">Suivez vos dépenses au jour le jour</p>
        </div>
      </button>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="pt-5">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                <c.icon className="w-5 h-5 text-primary" />
              </div>
              {c.money ? (
                <DualCurrencyStat amounts={c.money} />
              ) : (
                <p className="text-xl font-bold text-foreground">{c.value}</p>
              )}
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
            <DualCurrencyStat amounts={stats?.commission || { CDF: 0, USD: 0 }} />
            <p className="text-sm text-muted-foreground">Total plateforme</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
