import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CurrencySelector } from '@/components/CurrencySelector';
import { Loader2, Check } from 'lucide-react';

interface ExpenseTrackerSettings {
  trial_report_limit: number;
  monthly_price_cents: number;
  monthly_price_currency: 'CDF' | 'USD';
}

export default function ExpenseTrackerSettingsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ trial_report_limit: '', monthly_price: '', monthly_price_currency: 'CDF' as 'CDF' | 'USD' });
  const [saved, setSaved] = useState(false);
  const [seeded, setSeeded] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['expense-tracker-admin-settings'],
    queryFn: async () => (await api.get('/expense-tracker/admin/settings')).data as ExpenseTrackerSettings,
  });

  useEffect(() => {
    if (data && !seeded) {
      setForm({
        trial_report_limit: String(data.trial_report_limit),
        monthly_price: String(data.monthly_price_cents / 100),
        monthly_price_currency: data.monthly_price_currency,
      });
      setSeeded(true);
    }
  }, [data, seeded]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return (await api.put('/expense-tracker/admin/settings', {
        trial_report_limit: Number(form.trial_report_limit),
        monthly_price_cents: Math.round(parseFloat(form.monthly_price) * 100),
        monthly_price_currency: form.monthly_price_currency,
      })).data;
    },
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ['expense-tracker-admin-settings'] });
      setTimeout(() => setSaved(false), 2000);
    },
  });

  if (isLoading || !data) {
    return (
      <div className="p-6 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 pb-28 md:pb-6 space-y-6 max-w-xl mx-auto">
      <PageHeader title="Gestion de dépenses — Configuration" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Essai gratuit et abonnement Pro</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            S'applique à tous les rôles sauf entreprise. Un changement ici n'affecte que les nouveaux utilisateurs — la limite déjà attribuée à un essai en cours ne bouge jamais.
          </p>
          <div className="space-y-2">
            <Label htmlFor="trial_report_limit" className="font-semibold text-sm">Nombre de dépenses autorisées en essai gratuit</Label>
            <Input
              id="trial_report_limit"
              type="number"
              min={0}
              value={form.trial_report_limit}
              onChange={(e) => setForm({ ...form, trial_report_limit: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label className="font-semibold text-sm">Devise du prix mensuel</Label>
            <CurrencySelector value={form.monthly_price_currency} onChange={(c) => setForm({ ...form, monthly_price_currency: c })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="monthly_price" className="font-semibold text-sm">Prix mensuel du mode Pro ({form.monthly_price_currency})</Label>
            <Input
              id="monthly_price"
              type="number"
              step="0.01"
              value={form.monthly_price}
              onChange={(e) => setForm({ ...form, monthly_price: e.target.value })}
            />
          </div>
          <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? (
              <Loader2 className="mr-2 w-4 h-4 animate-spin" />
            ) : saved ? (
              <Check className="mr-2 w-4 h-4" />
            ) : null}
            Enregistrer
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
