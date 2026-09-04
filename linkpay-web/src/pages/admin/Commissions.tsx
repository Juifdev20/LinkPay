import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { CurrencySelector } from '@/components/CurrencySelector';
import { Loader2, Plus, X } from 'lucide-react';

const emptyForm = {
  name: '',
  percent: '',
  fixed_cents: '',
  min_cents: '',
  max_cents: '',
  applies_to: 'all',
  currency: 'CDF' as 'CDF' | 'USD',
};

export default function AdminCommissionsPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  const { data } = useQuery({
    queryKey: ['commission-rules'],
    queryFn: async () => {
      const { data } = await api.get('/commissions/rules');
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      await api.post('/commissions/rules', {
        name: form.name,
        percent: form.percent,
        fixed_cents: form.fixed_cents ? Number(form.fixed_cents) : undefined,
        min_cents: form.min_cents ? Number(form.min_cents) : undefined,
        max_cents: form.max_cents ? Number(form.max_cents) : undefined,
        applies_to: form.applies_to,
        currency: form.currency,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-rules'] });
      setForm(emptyForm);
      setShowForm(false);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.put(`/commissions/rules/${id}/deactivate`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['commission-rules'] }),
  });

  return (
    <div className="p-6 pb-28 md:pb-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader
        title="Règles de commission"
        action={{ label: 'Nouvelle règle', icon: Plus, onClick: () => setShowForm(true) }}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-bold">{data?.length || 0} règle(s)</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.length ? (
            <div>
              {data.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between gap-3 py-3 border-b border-border last:border-0">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-foreground truncate">{r.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(parseFloat(r.percent) * 100).toFixed(2)}%
                      {r.fixed_cents ? ` + ${r.fixed_cents} c` : ''} · {r.applies_to} · {r.currency}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant={r.is_active ? 'success' : 'secondary'}>{r.is_active ? 'Active' : 'Inactive'}</Badge>
                    {r.is_active && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={deactivateMutation.isPending}
                        onClick={() => deactivateMutation.mutate(r.id)}
                      >
                        {deactivateMutation.isPending && deactivateMutation.variables === r.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <X className="w-4 h-4" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-6">Aucune règle</p>
          )}
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle règle de commission</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rule_name">Nom</Label>
              <Input id="rule_name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Commission standard" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="rule_percent">Pourcentage (ex: 0.025 = 2,5%)</Label>
                <Input id="rule_percent" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} placeholder="0.025" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rule_fixed">Frais fixe (centimes)</Label>
                <Input id="rule_fixed" type="number" value={form.fixed_cents} onChange={(e) => setForm({ ...form, fixed_cents: e.target.value })} placeholder="0" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rule_min">Minimum (centimes)</Label>
                <Input id="rule_min" type="number" value={form.min_cents} onChange={(e) => setForm({ ...form, min_cents: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rule_max">Maximum (centimes)</Label>
                <Input id="rule_max" type="number" value={form.max_cents} onChange={(e) => setForm({ ...form, max_cents: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Devise</Label>
              <CurrencySelector value={form.currency} onChange={(c) => setForm({ ...form, currency: c })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Annuler</Button>
            <Button
              disabled={!form.name || !form.percent || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
              Créer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
