import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/PageHeader';
import { Loader2, Check } from 'lucide-react';

const CURRENCIES = ['CDF', 'USD'] as const;
const MODES = [
  { value: 'read_only', label: 'Lecture simple (consulter seulement)' },
  { value: 'blocked', label: 'Bloqué (fonctionnalités fermées)' },
];

const toUnits = (cents: number | undefined) => (cents === undefined ? '' : String(cents / 100));
const toCents = (v: string) => (v.trim() === '' ? null : Math.round(parseFloat(v.replace(',', '.')) * 100));
const validPrice = (v: string) => v.trim() === '' || (!Number.isNaN(parseFloat(v.replace(',', '.'))) && parseFloat(v.replace(',', '.')) > 0);
const msg = (e: any) => e?.response?.data?.message;

function Saved({ show }: { show: boolean }) {
  return show ? <span className="text-xs text-green-600 flex items-center gap-1"><Check className="w-3 h-3" /> Enregistré</span> : null;
}

function PriceCard({ prices }: { prices: Record<string, number> }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({ CDF: toUnits(prices?.CDF), USD: toUnits(prices?.USD) });
  useEffect(() => setForm({ CDF: toUnits(prices?.CDF), USD: toUnits(prices?.USD) }), [prices]);
  const valid = CURRENCIES.every((c) => validPrice(form[c]));
  const save = useMutation({
    mutationFn: async () => api.put('/admin/subscription/prices', { prices: Object.fromEntries(CURRENCIES.map((c) => [c, toCents(form[c])])) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-subscription'] }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-bold">Prix de l'abonnement mensuel</CardTitle>
        <p className="text-xs text-muted-foreground">Un seul prix par mois, tout est inclus. Saisi dans la devise (ex. 15000 = 15 000 CDF). Vide = pas vendu dans cette devise.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {CURRENCIES.map((c) => (
            <div key={c} className="space-y-1">
              <Label className="text-xs">Prix par mois ({c})</Label>
              <Input aria-label={`Prix par mois ${c}`} inputMode="decimal" placeholder="Pas vendu" value={form[c]} onChange={(e) => setForm({ ...form, [c]: e.target.value })} />
            </div>
          ))}
        </div>
        {msg(save.error) && <p className="text-sm text-destructive">{msg(save.error)}</p>}
        <div className="flex items-center gap-3">
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enregistrer'}</Button>
          <Saved show={save.isSuccess} />
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsCard({ settings }: { settings: any }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ trial_days: '30', trial_end_mode: 'read_only', expiry_mode: 'read_only', reminder_days: '7, 3, 1' });
  useEffect(() => {
    if (settings) setForm({ trial_days: String(settings.trial_days), trial_end_mode: settings.trial_end_mode, expiry_mode: settings.expiry_mode, reminder_days: (settings.reminder_days || []).join(', ') });
  }, [settings]);

  const reminders = form.reminder_days.split(/[,\s]+/).filter(Boolean).map(Number);
  const valid = /^\d+$/.test(form.trial_days) && +form.trial_days <= 365 && reminders.every((n) => Number.isInteger(n) && n >= 1 && n <= 90);
  const save = useMutation({
    mutationFn: async () => api.put('/admin/subscription/settings', { trial_days: +form.trial_days, trial_end_mode: form.trial_end_mode, expiry_mode: form.expiry_mode, reminder_days: reminders }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-subscription'] }),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base font-bold">Essai gratuit, fin de période et rappels</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="trial_days" className="font-semibold">Durée de l'essai gratuit (jours)</Label>
          <Input id="trial_days" inputMode="numeric" value={form.trial_days} onChange={(e) => setForm({ ...form, trial_days: e.target.value })} className="w-32" />
          <p className="text-xs text-muted-foreground">Compté à partir de la validation de l'entreprise. Pendant l'essai, tout est utilisable. 0 = pas d'essai.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="trial_end_mode" className="font-semibold">À la fin de l'essai, sans abonnement</Label>
          <Select id="trial_end_mode" value={form.trial_end_mode} onChange={(e) => setForm({ ...form, trial_end_mode: e.target.value })}>
            {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="expiry_mode" className="font-semibold">Quand un abonnement payé expire</Label>
          <Select id="expiry_mode" value={form.expiry_mode} onChange={(e) => setForm({ ...form, expiry_mode: e.target.value })}>
            {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
          <p className="text-xs text-muted-foreground">Dans les deux cas, les paiements des clients, le portefeuille et les retraits ne sont jamais bloqués.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reminders" className="font-semibold">Rappels avant l'expiration (jours restants)</Label>
          <Input id="reminders" value={form.reminder_days} onChange={(e) => setForm({ ...form, reminder_days: e.target.value })} placeholder="7, 3, 1" />
          <p className="text-xs text-muted-foreground">Le patron reçoit une notification à chacun de ces seuils, pour l'essai comme pour l'abonnement, puis le jour de l'expiration.</p>
        </div>
        {msg(save.error) && <p className="text-sm text-destructive">{msg(save.error)}</p>}
        <div className="flex items-center gap-3">
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enregistrer'}</Button>
          <Saved show={save.isSuccess} />
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminSubscriptionsPage() {
  const { data, isLoading } = useQuery({ queryKey: ['admin-subscription'], queryFn: async () => (await api.get('/admin/subscription')).data });
  if (isLoading || !data) return <div className="p-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="p-6 pb-28 md:pb-6 space-y-6 max-w-3xl mx-auto">
      <PageHeader title="Abonnements" />

      <Card>
        <CardHeader><CardTitle className="text-base font-bold">Recettes des abonnements</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-6">
          <div>
            <p className="text-2xl font-bold">{data.active_subscriptions}</p>
            <p className="text-xs text-muted-foreground">abonnement{data.active_subscriptions > 1 ? 's' : ''} actif{data.active_subscriptions > 1 ? 's' : ''}</p>
          </div>
          {(data.revenue || []).length === 0 && <p className="text-sm text-muted-foreground self-center">Aucun paiement pour le moment.</p>}
          {(data.revenue || []).map((r: any) => (
            <div key={r.currency}>
              <p className="text-2xl font-bold">{formatCurrency(Number(r.total_cents), r.currency)}</p>
              <p className="text-xs text-muted-foreground">{r.purchases} paiement{r.purchases > 1 ? 's' : ''} en {r.currency}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <PriceCard prices={data.prices} />
      <SettingsCard settings={data.settings} />

      <Card>
        <CardHeader><CardTitle className="text-base font-bold">Derniers paiements</CardTitle></CardHeader>
        <CardContent className="divide-y divide-border">
          {(data.recent_purchases || []).length === 0 && <p className="text-sm text-muted-foreground">Aucun paiement.</p>}
          {(data.recent_purchases || []).map((p: any) => (
            <div key={p.id} className="py-3 flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="font-semibold">{p.organization?.name || p.organization_id}</p>
                <p className="text-xs text-muted-foreground">{p.months} mois · jusqu'au {formatDate(p.expires_at)} · payé le {formatDate(p.created_at)}</p>
              </div>
              <span className="font-semibold whitespace-nowrap">{formatCurrency(p.amount_cents, p.currency)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
