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
import { formatCurrency } from '@/lib/utils';
import { Loader2, Pencil } from 'lucide-react';

const OPERATIONS: Record<string, { title: string; hint: string }> = {
  TRANSFER: {
    title: 'Transfert entre portefeuilles',
    hint: "Frais payés par l'expéditeur, en plus du montant. Les comptes marchands ne reçoivent pas de transferts.",
  },
  WITHDRAWAL: {
    title: 'Retrait vers Mobile Money ou banque',
    hint: "Frais prélevés sur le portefeuille, en plus du montant retiré. Ils couvrent le coût du virement.",
  },
  WALLET_PAYMENT: {
    title: "Paiement d'une facture depuis le portefeuille",
    hint: "La commission sur les ventes se règle à part, dans « Commissions ».",
  },
};

type Form = {
  fee_percent: string; // in %, e.g. "1" = 1 %
  fee_fixed: string;
  min: string;
  max: string;
  daily: string;
  monthly: string;
  is_active: boolean;
};

const unitsOf = (cents: number | null | undefined) => (cents == null ? '' : String(cents / 100));
const centsOf = (value: string) => Math.round(parseFloat(value) * 100);
const capOf = (value: string) => (value.trim() === '' ? null : centsOf(value));
const percentLabel = (fraction: string | number) => `${parseFloat(String(fraction)) * 100} %`;

function formOf(rule: any): Form {
  return {
    fee_percent: String(parseFloat(rule.fee_percent) * 100),
    fee_fixed: unitsOf(rule.fee_fixed_cents),
    min: unitsOf(rule.min_cents),
    max: unitsOf(rule.max_cents),
    daily: unitsOf(rule.daily_max_cents),
    monthly: unitsOf(rule.monthly_max_cents),
    is_active: rule.is_active,
  };
}

export default function AdminWalletLimitsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<Form | null>(null);

  const { data: rules, isLoading } = useQuery({
    queryKey: ['wallet-limits'],
    queryFn: async () => (await api.get('/wallet-limits')).data as any[],
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      await api.put(`/wallet-limits/${editing.id}`, {
        // Percent -> fraction, rounded: 1.1 / 100 is 0.011000000000000001 in floating point, which the API rejects.
        fee_percent: Math.round(parseFloat(form!.fee_percent) * 100) / 10000,
        fee_fixed_cents: centsOf(form!.fee_fixed || '0'),
        min_cents: centsOf(form!.min),
        max_cents: capOf(form!.max),
        daily_max_cents: capOf(form!.daily),
        monthly_max_cents: capOf(form!.monthly),
        is_active: form!.is_active,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wallet-limits'] });
      setEditing(null);
    },
  });
  const saveError = (saveMutation.error as any)?.response?.data?.message;

  const openEditor = (rule: any) => {
    saveMutation.reset();
    setEditing(rule);
    setForm(formOf(rule));
  };
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const valid =
    !!form &&
    form.fee_percent.trim() !== '' && !Number.isNaN(parseFloat(form.fee_percent)) && parseFloat(form.fee_percent) >= 0 &&
    form.min.trim() !== '' && centsOf(form.min) >= 1;

  return (
    <div className="p-6 pb-28 md:pb-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader title="Frais et limites du portefeuille" />

      {isLoading && <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />}

      {Object.entries(OPERATIONS).map(([opType, op]) => {
        const rows = (rules || []).filter((r) => r.op_type === opType);
        if (!rows.length) return null;
        return (
          <Card key={opType}>
            <CardHeader>
              <CardTitle className="text-base font-bold">{op.title}</CardTitle>
              <p className="text-xs text-muted-foreground">{op.hint}</p>
            </CardHeader>
            <CardContent>
              {rows.map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-3 py-3 border-b border-border last:border-0">
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-semibold text-sm text-foreground">
                      {r.currency} · frais {percentLabel(r.fee_percent)}
                      {r.fee_fixed_cents ? ` + ${formatCurrency(r.fee_fixed_cents, r.currency)}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Min {formatCurrency(r.min_cents, r.currency)}
                      {r.max_cents != null ? ` · max ${formatCurrency(r.max_cents, r.currency)}` : ' · pas de max'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.daily_max_cents != null ? `${formatCurrency(r.daily_max_cents, r.currency)}/jour` : 'pas de limite/jour'}
                      {' · '}
                      {r.monthly_max_cents != null ? `${formatCurrency(r.monthly_max_cents, r.currency)}/mois` : 'pas de limite/mois'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant={r.is_active ? 'success' : 'secondary'}>{r.is_active ? 'Active' : 'Inactive'}</Badge>
                    <Button size="sm" variant="outline" onClick={() => openEditor(r)}>
                      <Pencil className="w-4 h-4 mr-1" /> Modifier
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing && OPERATIONS[editing.op_type]?.title} — {editing?.currency}
            </DialogTitle>
          </DialogHeader>
          {form && editing && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">Les montants sont en {editing.currency}. Laissez un plafond vide pour ne pas en mettre.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="wl_percent">Frais (%)</Label>
                  <Input id="wl_percent" inputMode="decimal" value={form.fee_percent} onChange={(e) => set({ fee_percent: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wl_fixed">Frais fixes</Label>
                  <Input id="wl_fixed" inputMode="decimal" value={form.fee_fixed} onChange={(e) => set({ fee_fixed: e.target.value })} placeholder="0" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wl_min">Minimum par opération</Label>
                  <Input id="wl_min" inputMode="decimal" value={form.min} onChange={(e) => set({ min: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wl_max">Maximum par opération</Label>
                  <Input id="wl_max" inputMode="decimal" value={form.max} onChange={(e) => set({ max: e.target.value })} placeholder="Pas de maximum" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wl_daily">Limite par jour</Label>
                  <Input id="wl_daily" inputMode="decimal" value={form.daily} onChange={(e) => set({ daily: e.target.value })} placeholder="Pas de limite" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wl_monthly">Limite par mois</Label>
                  <Input id="wl_monthly" inputMode="decimal" value={form.monthly} onChange={(e) => set({ monthly: e.target.value })} placeholder="Pas de limite" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_active} onChange={(e) => set({ is_active: e.target.checked })} />
                Règle active (désactivée : plus de frais ni de limites sur cette opération)
              </label>
              {saveMutation.isError && (
                <p className="text-sm text-destructive">
                  {Array.isArray(saveError) ? saveError.join(', ') : saveError || "Échec de l'enregistrement"}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Annuler</Button>
            <Button disabled={!valid || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
