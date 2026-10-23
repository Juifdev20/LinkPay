import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Truck } from 'lucide-react';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const CURRENCIES = ['CDF', 'USD'] as const;
const toUnits = (cents: number | undefined) => (cents === undefined ? '' : String(cents / 100));
const toCents = (v: string) => (v.trim() === '' ? null : Math.round(parseFloat(v.replace(',', '.')) * 100));
const validPrice = (v: string) => v.trim() === '' || (!Number.isNaN(parseFloat(v.replace(',', '.'))) && parseFloat(v.replace(',', '.')) > 0);
const msg = (e: any) => e?.response?.data?.message;

/**
 * Super admin: the "Fournisseur" plan (DECISIONS.md 23/10) — the monthly price per currency, the free trial (days,
 * shown to every business that opens « Devenir fournisseur »), and the months offered on the yearly plan. Nothing
 * of it is written in the code.
 */
export function SupplierPlanAdmin() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin-supplier-plan'], queryFn: async () => (await api.get('/admin/supplier-plan')).data, retry: false });
  const [prices, setPrices] = useState<Record<string, string>>({ CDF: '', USD: '' });
  const [form, setForm] = useState({ trial_days: '30', annual_free_months: '2', reminder_days: '7, 3, 1' });
  useEffect(() => {
    if (!data) return;
    setPrices({ CDF: toUnits(data.prices?.CDF), USD: toUnits(data.prices?.USD) });
    setForm({ trial_days: String(data.settings.trial_days), annual_free_months: String(data.settings.annual_free_months), reminder_days: (data.settings.reminder_days || []).join(', ') });
  }, [data]);

  const reminders = form.reminder_days.split(/[,\s]+/).filter(Boolean).map(Number);
  const free = Number(form.annual_free_months);
  const valid = CURRENCIES.every((c) => validPrice(prices[c])) && /^\d+$/.test(form.trial_days) && +form.trial_days <= 365
    && /^\d+$/.test(form.annual_free_months) && free <= 11 && reminders.every((n) => Number.isInteger(n) && n >= 1 && n <= 90);
  const save = useMutation({
    mutationFn: async () => {
      await api.put('/admin/supplier-plan/prices', { prices: Object.fromEntries(CURRENCIES.map((c) => [c, toCents(prices[c])])) });
      await api.put('/admin/supplier-plan/settings', { trial_days: +form.trial_days, annual_free_months: free, reminder_days: reminders });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-supplier-plan'] }),
  });

  if (!data) return null;
  const year = (c: string) => {
    const cents = toCents(prices[c]);
    return cents ? formatCurrency(cents * (12 - (Number.isInteger(free) ? free : 0)), c) : null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-bold flex items-center gap-2"><Truck className="w-4 h-4" /> Abonnement Fournisseur</CardTitle>
        <p className="text-xs text-muted-foreground">
          Payé par les entreprises qui vendent aux autres entreprises (réseau de fournisseurs). Les acheteurs ne paient rien de plus.
          {' '}{data.suppliers.total} fournisseur{data.suppliers.total > 1 ? 's' : ''} : {data.suppliers.trial} en essai, {data.suppliers.active} abonné{data.suppliers.active > 1 ? 's' : ''}, {data.suppliers.expired} sans abonnement.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-6">
          {(data.revenue || []).length === 0 && <p className="text-sm text-muted-foreground">Aucun paiement pour le moment.</p>}
          {(data.revenue || []).map((r: any) => (
            <div key={r.currency}>
              <p className="text-xl font-bold">{formatCurrency(Number(r.total_cents), r.currency)}</p>
              <p className="text-xs text-muted-foreground">{r.purchases} paiement{r.purchases > 1 ? 's' : ''} en {r.currency}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {CURRENCIES.map((c) => (
            <div key={c} className="space-y-1">
              <Label className="text-xs">Prix par mois ({c})</Label>
              <Input aria-label={`Prix Fournisseur par mois ${c}`} inputMode="decimal" placeholder="Pas vendu" value={prices[c]} onChange={(e) => setPrices({ ...prices, [c]: e.target.value })} />
              {year(c) && <p className="text-[11px] text-muted-foreground">L'année : {year(c)}</p>}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="sp_trial" className="text-xs">Essai gratuit (jours)</Label>
            <Input id="sp_trial" inputMode="numeric" value={form.trial_days} onChange={(e) => setForm({ ...form, trial_days: e.target.value })} />
            <p className="text-[11px] text-muted-foreground">Annoncé dès « Devenir fournisseur ». 0 = pas d'essai. Vaut pour les nouveaux fournisseurs.</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sp_free" className="text-xs">Mois offerts sur l'année</Label>
            <Input id="sp_free" inputMode="numeric" value={form.annual_free_months} onChange={(e) => setForm({ ...form, annual_free_months: e.target.value })} />
            <p className="text-[11px] text-muted-foreground">12 mois pour le prix de {Number.isInteger(free) && free <= 11 ? 12 - free : '…'}. 0 = pas de réduction.</p>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sp_rem" className="text-xs">Rappels avant la fin (jours restants)</Label>
          <Input id="sp_rem" value={form.reminder_days} onChange={(e) => setForm({ ...form, reminder_days: e.target.value })} placeholder="7, 3, 1" />
        </div>
        {msg(save.error) && <p className="text-sm text-destructive">{msg(save.error)}</p>}
        <div className="flex items-center gap-3">
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enregistrer'}</Button>
          {save.isSuccess && <span className="text-xs text-green-600 flex items-center gap-1"><Check className="w-3 h-3" /> Enregistré</span>}
        </div>
        {(data.recent_purchases || []).length > 0 && (
          <div className="divide-y divide-border border-t border-border pt-2">
            {data.recent_purchases.slice(0, 10).map((p: any) => (
              <div key={p.id} className="py-2 flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold">{p.organization?.name || p.organization_id}</p>
                  <p className="text-xs text-muted-foreground">{p.plan === 'annual' ? `Année (${p.months - p.months_charged} mois offerts)` : `${p.months} mois`} · jusqu'au {formatDate(p.expires_at)}</p>
                </div>
                <span className="font-semibold whitespace-nowrap">{formatCurrency(p.amount_cents, p.currency)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
