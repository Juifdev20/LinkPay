import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Gift, Loader2, Search, Store, Truck, X } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PinInput } from '@/components/PinInput';
import { OrderCard } from '@/components/supplier/OrderCard';
import { formatCurrency, formatDate, cn } from '@/lib/utils';

const msg = (e: any) => e?.response?.data?.message || 'Action impossible, réessayez.';
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const days = (n: number) => `${n} jour${n > 1 ? 's' : ''}`;
const TABS = [
  { key: 'profil', label: 'Abonnement et fiche' },
  { key: 'catalogue', label: 'Catalogue' },
  { key: 'clients', label: 'Clients' },
  { key: 'commandes', label: 'Commandes reçues' },
] as const;

/**
 * « Espace fournisseur » (DECISIONS.md 23/10, phase C), every sector: an enterprise sells to other enterprises.
 * Not a supplier yet → what it is, the free trial announced (days set by the super admin) and the prices, then the
 * form (the owner). A supplier → its plan (trial days left, monthly or yearly payment), its catalog, its clients
 * (invitations to accept) and the orders it receives. The owner and the managers of the selling stations work here.
 */
export default function SupplierSpacePage() {
  const user = useAuthStore((s) => s.user);
  const isOwner = user?.role === 'enterprise' || !!user?.acting_as_org_id;
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get('onglet'))?.key ?? 'profil') as (typeof TABS)[number]['key'];
  const { data: org } = useQuery({ queryKey: ['my-organization'], queryFn: async () => (await api.get('/organizations/me')).data });
  const { data, isLoading, error } = useQuery({
    queryKey: ['supplier-profile', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/supplier-profile`)).data,
    enabled: !!org?.id,
    retry: false,
  });

  if (isLoading || !org) return <div className="p-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  if (error) return <p className="p-6 text-sm text-destructive">{msg(error)}</p>;

  return (
    <div className="p-4 md:p-6 pb-28 md:pb-6 space-y-5 max-w-3xl lg:max-w-6xl mx-auto">
      <PageHeader title="Espace fournisseur" />
      {!data.profile ? (
        <BecomeSupplier orgId={org.id} offer={data.offer} isOwner={isOwner} />
      ) : (
        <>
          <PlanBanner plan={data.plan} profile={data.profile} />
          <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
            <div className="flex w-max gap-2">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setParams(t.key === 'profil' ? {} : { onglet: t.key }, { replace: true })}
                  className={cn('rounded-full border px-3 py-1.5 text-sm font-medium', tab === t.key ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground')}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          {tab === 'profil' && (
            <>
              <PlanAndProfile orgId={org.id} data={data} isOwner={isOwner} />
              <SellingStations orgId={org.id} stations={data.stations || []} isOwner={isOwner} />
            </>
          )}
          {tab === 'catalogue' && <Catalog orgId={org.id} stations={(data.stations || []).filter((st: any) => st.active)} isOwner={isOwner} myStation={data.my_station} />}
          {tab === 'clients' && <Clients orgId={org.id} />}
          {tab === 'commandes' && <ReceivedOrders orgId={org.id} stations={data.stations || []} />}
        </>
      )}
    </div>
  );
}

/** Always on top: the trial days left, or the plan's end, or "no new orders" when it has ended. */
function PlanBanner({ plan, profile }: { plan: any; profile: any }) {
  const tone = plan.status === 'expired' ? 'border-destructive/30 bg-destructive/10 text-destructive' : plan.status === 'trial' ? 'border-primary/30 bg-primary/5 text-foreground' : 'border-green-500/30 bg-green-500/10 text-foreground';
  return (
    <div className={cn('rounded-xl border px-4 py-3 text-sm flex flex-wrap items-center gap-x-3 gap-y-1', tone)}>
      <span className="font-semibold">N° fournisseur {profile.supplier_number}</span>
      <span>·</span>
      {plan.status === 'trial' && <span><Gift className="inline w-4 h-4 mr-1" />Essai gratuit : il vous reste <strong>{days(plan.trial_days_left)}</strong> (jusqu'au {formatDate(plan.trial_ends_at)}).</span>}
      {plan.status === 'active' && <span>Abonnement Fournisseur actif jusqu'au {formatDate(plan.plan_expires_at)} ({days(plan.plan_days_left)}).</span>}
      {plan.status === 'expired' && <span>Abonnement terminé : vos clients ne peuvent plus vous passer de nouvelles commandes. Les commandes en cours continuent.</span>}
      {!profile.active && <Badge variant="secondary">En pause</Badge>}
    </div>
  );
}

function priceLine(offer: any) {
  const parts = Object.entries(offer.prices || {}).map(([c, v]) => `${formatCurrency(v as number, c)} par mois`);
  return parts.length ? parts.join(' ou ') : 'prix bientôt disponible';
}

/** Not a supplier yet: the offer (trial from the super admin), then the form for the owner. */
function BecomeSupplier({ orgId, offer, isOwner }: { orgId: string; offer: any; isOwner: boolean }) {
  const qc = useQueryClient();
  const { data: stations } = useQuery({
    queryKey: ['org-merchants', orgId],
    queryFn: async () => (await api.get(`/organizations/${orgId}/merchants`)).data as { id: string; name: string }[],
  });
  const [form, setForm] = useState({ display_name: '', phone: '', address: '', delivery_zone: '', fee: '', fee_currency: 'CDF' });
  const [picked, setPicked] = useState<string[] | null>(null);
  // One station: ticked by itself. Several: the owner ticks those that sell.
  const chosen = picked ?? (stations?.length === 1 ? [stations[0].id] : []);
  const toggle = (id: string) => setPicked(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  const become = useMutation({
    mutationFn: async () => (await api.post(`/organizations/${orgId}/supplier-profile`, {
      display_name: form.display_name.trim() || undefined, phone: form.phone || undefined, address: form.address || undefined,
      delivery_zone: form.delivery_zone || undefined, merchant_ids: chosen,
      ...(form.fee.trim() ? { default_delivery_fee_cents: Math.round(parseFloat(form.fee.replace(',', '.')) * 100), default_delivery_currency: form.fee_currency } : {}),
    })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier-profile', orgId] }),
  });

  return (
    <div className="space-y-5 lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0 lg:items-start">
      <Card>
        <CardHeader><CardTitle className="text-base font-bold flex items-center gap-2"><Truck className="w-4 h-4" /> Vendez à d'autres entreprises</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {offer.trial_days > 0 && (
            <div className="rounded-xl bg-primary/10 px-4 py-3 text-foreground">
              <Gift className="inline w-4 h-4 mr-1 text-primary" />
              <strong>Essai gratuit de {days(offer.trial_days)}</strong> dès que vous devenez fournisseur.
            </div>
          )}
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>Un numéro de fournisseur à donner à vos clients : ils vous invitent, vous acceptez.</li>
            <li>Une ou plusieurs stations qui vendent (Goma, Beni…), chacune avec son catalogue tiré de son stock, à vos prix pour les entreprises. Un seul abonnement pour toutes.</li>
            <li>Le client choisit la station qui le sert : la commande arrive chez vous et chez le gérant de cette station, qui fixe les frais de livraison.</li>
            <li>Payé par ScanLinkPay (automatique) ou en espèces / Mobile Money que vous confirmez. La livraison sort du stock toute seule.</li>
          </ul>
          <p>
            Ensuite : <strong>{priceLine(offer)}</strong>
            {offer.annual_free_months > 0 && <>, ou l'année avec <strong>{offer.annual_free_months} mois offert{offer.annual_free_months > 1 ? 's' : ''}</strong></>}.
            Vos clients ne paient rien de plus.
          </p>
        </CardContent>
      </Card>

      {isOwner ? (
        <Card>
          <CardHeader><CardTitle className="text-base font-bold">Devenir fournisseur</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="sp_name">Nom affiché à vos clients</Label><Input id="sp_name" placeholder="Nom de votre entreprise" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>Stations qui vendent aux entreprises</Label>
              <div className="rounded-xl border border-border divide-y divide-border">
                {(stations || []).map((st) => (
                  <label key={st.id} className="flex items-center gap-3 px-3 py-2.5 text-sm cursor-pointer">
                    <input type="checkbox" checked={chosen.includes(st.id)} onChange={() => toggle(st.id)} />
                    <span className="font-medium">{st.name}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Chaque station cochée a son catalogue (son stock) ; ses gérants traitent ses commandes. Vous pourrez en ajouter ou en retirer ensuite.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="sp_phone">Téléphone</Label><Input id="sp_phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="sp_zone">Zone de livraison (par défaut)</Label><Input id="sp_zone" placeholder="Kinshasa, Gombe…" value={form.delivery_zone} onChange={(e) => setForm({ ...form, delivery_zone: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="sp_addr">Adresse</Label><Input id="sp_addr" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div className="grid grid-cols-[1fr_100px] gap-3">
              <div className="space-y-1.5"><Label htmlFor="sp_fee">Frais de livraison proposés (facultatif)</Label><Input id="sp_fee" inputMode="decimal" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} /></div>
              <div className="space-y-1.5"><Label htmlFor="sp_feecur">Devise</Label><Select id="sp_feecur" value={form.fee_currency} onChange={(e) => setForm({ ...form, fee_currency: e.target.value })}><option>CDF</option><option>USD</option></Select></div>
            </div>
            <p className="text-xs text-muted-foreground -mt-1">Proposés par défaut à chaque station (réglables station par station ensuite) ; changés à chaque commande selon la distance.</p>
            {become.isError && <p className="text-sm text-destructive">{msg(become.error)}</p>}
            <Button className="w-full" disabled={!chosen.length || become.isPending} onClick={() => become.mutate()}>
              {become.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
              {offer.trial_days > 0 ? `Devenir fournisseur — essai gratuit de ${days(offer.trial_days)}` : 'Devenir fournisseur'}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card><CardContent className="p-4 text-sm text-muted-foreground">Seul le patron peut faire de l'entreprise un fournisseur.</CardContent></Card>
      )}
    </div>
  );
}

/** The plan (owner pays: monthly × N or the year) and the profile. */
function PlanAndProfile({ orgId, data, isOwner }: { orgId: string; data: any; isOwner: boolean }) {
  const qc = useQueryClient();
  const { offer, profile } = data;
  const currencies = Object.keys(offer.prices || {});
  const [currency, setCurrency] = useState(currencies.includes('USD') ? 'USD' : currencies[0] || 'USD');
  const [planKind, setPlanKind] = useState<'monthly' | 'annual'>('monthly');
  const [months, setMonths] = useState(1);
  const [pin, setPin] = useState('');
  const [done, setDone] = useState('');
  const key = useRef(newKey());
  const { data: wallet } = useQuery({ queryKey: ['wallet'], queryFn: async () => (await api.get('/wallet')).data, enabled: isOwner });
  const price = offer.prices?.[currency] ?? 0;
  const charged = planKind === 'annual' ? 12 - offer.annual_free_months : months;
  const total = price * charged;
  const balance = wallet?.balances?.[currency] ?? 0;
  const pay = useMutation({
    mutationFn: async () => (await api.post(`/organizations/${orgId}/supplier-plan/subscribe`, { plan: planKind, months: planKind === 'monthly' ? months : undefined, currency, pin }, { headers: { 'Idempotency-Key': key.current } })).data,
    onSuccess: (res) => {
      key.current = newKey();
      setPin('');
      setDone(`Abonnement Fournisseur actif jusqu'au ${formatDate(res.plan_expires_at)}.`);
      qc.invalidateQueries({ queryKey: ['supplier-profile', orgId] });
      qc.invalidateQueries({ queryKey: ['wallet'] });
    },
  });
  const [edit, setEdit] = useState({ display_name: profile.display_name || '', phone: profile.phone || '', address: profile.address || '', delivery_zone: profile.delivery_zone || '', fee: profile.default_delivery_fee_cents != null ? String(profile.default_delivery_fee_cents / 100) : '', fee_currency: profile.default_delivery_currency || 'CDF' });
  const update = useMutation({
    mutationFn: async (body: any) => (await api.put(`/organizations/${orgId}/supplier-profile`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier-profile', orgId] }),
  });

  return (
    <div className="space-y-5 lg:grid lg:grid-cols-2 lg:gap-6 lg:space-y-0 lg:items-start">
      <Card>
        <CardHeader><CardTitle className="text-base font-bold">Abonnement Fournisseur</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!currencies.length ? (
            <p className="text-sm text-muted-foreground">Le prix n'est pas encore fixé : vous pourrez payer dès qu'il le sera.</p>
          ) : !isOwner ? (
            <p className="text-sm text-muted-foreground">Le patron paie l'abonnement : {priceLine(offer)}.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                {(['monthly', 'annual'] as const).map((k) => (
                  <button key={k} onClick={() => setPlanKind(k)} className={cn('rounded-xl border p-3 text-left text-sm', planKind === k ? 'border-primary bg-primary/5' : 'border-border')}>
                    <p className="font-semibold">{k === 'monthly' ? 'Au mois' : "À l'année"}</p>
                    <p className="text-xs text-muted-foreground">
                      {k === 'monthly' ? `${formatCurrency(price, currency)} / mois` : `${formatCurrency(price * (12 - offer.annual_free_months), currency)} pour 12 mois${offer.annual_free_months ? ` (${offer.annual_free_months} offert${offer.annual_free_months > 1 ? 's' : ''})` : ''}`}
                    </p>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {currencies.length > 1 && (
                  <Select aria-label="Devise" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-28">
                    {currencies.map((c) => <option key={c}>{c}</option>)}
                  </Select>
                )}
                {planKind === 'monthly' && (
                  <Select aria-label="Nombre de mois" value={String(months)} onChange={(e) => setMonths(Number(e.target.value))} className="w-36">
                    {[1, 2, 3, 6, 9, 12].map((n) => <option key={n} value={n}>{n} mois</option>)}
                  </Select>
                )}
              </div>
              <p className="text-sm">À payer : <strong>{formatCurrency(total, currency)}</strong> depuis votre portefeuille (solde {formatCurrency(balance, currency)}).</p>
              {data.plan.status === 'trial' && <p className="text-xs text-muted-foreground">Payer pendant l'essai ne le raccourcit pas : les mois commencent après l'essai.</p>}
              {balance < total && <Link className="text-sm text-primary underline" to={`/dashboard/wallet/topup?currency=${currency}&retour=/dashboard/organization/supplier`}>Recharger mon portefeuille</Link>}
              <div className="space-y-1.5">
                <Label className="font-semibold">Code PIN de transaction</Label>
                <PinInput value={pin} onChange={setPin} length={4} title="Confirmer le paiement" message={pay.isError ? msg(pay.error) : undefined} />
              </div>
              {done && <p className="text-sm text-green-600 flex items-center gap-1"><Check className="w-4 h-4" /> {done}</p>}
              <Button className="w-full" disabled={!price || balance < total || pin.length !== 4 || pay.isPending} onClick={() => pay.mutate()}>
                {pay.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : `Payer ${formatCurrency(total, currency)}`}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base font-bold">Fiche fournisseur</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="pf_name">Nom affiché</Label><Input id="pf_name" disabled={!isOwner} value={edit.display_name} onChange={(e) => setEdit({ ...edit, display_name: e.target.value })} /></div>
          <div className="grid grid-cols-1 gap-3">
            <div className="space-y-1.5"><Label htmlFor="pf_phone">Téléphone</Label><Input id="pf_phone" disabled={!isOwner} value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="pf_addr">Adresse</Label><Input id="pf_addr" disabled={!isOwner} value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></div>
          {update.isError && <p className="text-sm text-destructive">{msg(update.error)}</p>}
          {isOwner && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={update.isPending} onClick={() => update.mutate({
                display_name: edit.display_name, phone: edit.phone || null, address: edit.address || null,
              })}>Enregistrer</Button>
              <Button variant="outline" disabled={update.isPending} onClick={() => update.mutate({ active: !profile.active })}>
                {profile.active ? 'Mettre en pause' : 'Reprendre'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The owner ticks the stations that sell (one Fournisseur plan for all), and sets each one's delivery zone and
 * default fee — Goma and Beni don't deliver at the same distances.
 */
function SellingStations({ orgId, stations, isOwner }: { orgId: string; stations: any[]; isOwner: boolean }) {
  const qc = useQueryClient();
  const { data: all } = useQuery({
    queryKey: ['org-merchants', orgId],
    queryFn: async () => (await api.get(`/organizations/${orgId}/merchants`)).data as { id: string; name: string }[],
  });
  const [draft, setDraft] = useState<Record<string, { zone: string; fee: string; cur: string }>>({});
  const save = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: any }) => (await api.put(`/organizations/${orgId}/supplier-stations/${id}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier-profile', orgId] }),
  });
  const rowOf = (id: string) => stations.find((st) => st.merchant_id === id);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-bold">Stations qui vendent aux entreprises</CardTitle>
        <p className="text-xs text-muted-foreground">Un seul abonnement pour toutes. Le client choisit la station qui le sert ; chaque station a son catalogue et ses frais de livraison.</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {save.isError && <p className="text-sm text-destructive">{msg(save.error)}</p>}
        {(all || []).map((st) => {
          const row = rowOf(st.id);
          const on = !!row?.active;
          const d = draft[st.id] ?? { zone: row?.delivery_zone || '', fee: row?.default_delivery_fee_cents != null ? String(row.default_delivery_fee_cents / 100) : '', cur: row?.default_delivery_currency || 'CDF' };
          return (
            <div key={st.id} className={cn('rounded-xl border p-3 space-y-2', on ? 'border-primary/40 bg-primary/5' : 'border-border')}>
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 font-medium text-sm">
                  <input type="checkbox" disabled={!isOwner || save.isPending} checked={on} onChange={() => save.mutate({ id: st.id, body: { active: !on } })} />
                  {st.name}
                </label>
                <Badge variant={on ? 'success' : 'secondary'}>{on ? 'Vend aux entreprises' : 'Ne vend pas'}</Badge>
              </div>
              {on && (
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px_90px_auto] gap-2 items-end">
                  <Input aria-label={`Zone de livraison ${st.name}`} disabled={!isOwner} placeholder="Zone de livraison" value={d.zone} onChange={(e) => setDraft({ ...draft, [st.id]: { ...d, zone: e.target.value } })} />
                  <Input aria-label={`Frais de livraison ${st.name}`} disabled={!isOwner} inputMode="decimal" placeholder="Frais par défaut" value={d.fee} onChange={(e) => setDraft({ ...draft, [st.id]: { ...d, fee: e.target.value } })} />
                  <Select aria-label={`Devise ${st.name}`} disabled={!isOwner} value={d.cur} onChange={(e) => setDraft({ ...draft, [st.id]: { ...d, cur: e.target.value } })}><option>CDF</option><option>USD</option></Select>
                  {isOwner && (
                    <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate({ id: st.id, body: {
                      delivery_zone: d.zone || null,
                      default_delivery_fee_cents: d.fee.trim() ? Math.round(parseFloat(d.fee.replace(',', '.')) * 100) : null,
                      default_delivery_currency: d.fee.trim() ? d.cur : null,
                    } })}>Enregistrer</Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** One selling station's articles: put one in the catalog with its business price, change it, take it out. */
function Catalog({ orgId, stations, isOwner, myStation }: { orgId: string; stations: any[]; isOwner: boolean; myStation: string | null }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Record<string, { price: string; min: string }>>({});
  // The owner picks the station; a manager works on his own.
  // Opened from « Remplir son catalogue » (new station): that station first.
  const [params] = useSearchParams();
  const [picked, setPicked] = useState<string>(() => params.get('station') || '');
  const station = isOwner ? (stations.some((st) => st.merchant_id === picked) ? picked : stations[0]?.merchant_id || '') : myStation || '';
  const { data: items, isLoading, error } = useQuery({
    queryKey: ['supplier-catalog', orgId, station],
    queryFn: async () => (await api.get(`/organizations/${orgId}/supplier-catalog`, { params: station ? { merchant_id: station } : {} })).data as any[],
    enabled: !!station,
  });
  const save = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: any }) => (await api.put(`/organizations/${orgId}/supplier-catalog/${id}`, body)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier-catalog', orgId] }),
  });
  const rows = useMemo(() => (items || []).filter((i) => !query.trim() || i.name.toLowerCase().includes(query.trim().toLowerCase()) || (i.barcode || '').includes(query.trim())), [items, query]);
  if (!station) return <p className="text-sm text-muted-foreground">Aucune station ne vend aux entreprises : cochez-en une dans « Abonnement et fiche ».</p>;
  if (error) return <p className="text-sm text-destructive">{msg(error)}</p>;
  const inCatalog = (items || []).filter((i) => i.catalog?.active).length;

  return (
    <div className="space-y-3">
      {isOwner && stations.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {stations.map((st) => (
            <button key={st.merchant_id} onClick={() => setPicked(st.merchant_id)} className={cn('rounded-full border px-3 py-1.5 text-sm font-medium', station === st.merchant_id ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground')}>
              Catalogue de {st.name}
            </button>
          ))}
        </div>
      )}
      {isLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
      <p className="text-sm text-muted-foreground">{inCatalog} article{inCatalog > 1 ? 's' : ''} au catalogue. Vos clients voient le nom, votre prix entreprise et la quantité disponible — jamais votre prix d'achat.</p>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Rechercher un article…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {save.isError && <p className="text-sm text-destructive">{msg(save.error)}</p>}
      <div className="rounded-xl border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium">Article</th>
              <th className="px-3 py-2.5 text-right font-medium">Stock</th>
              <th className="hidden sm:table-cell px-3 py-2.5 text-right font-medium whitespace-nowrap">Prix boutique</th>
              <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">Prix entreprises</th>
              <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">Qté min.</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((i) => {
              const d = draft[i.id] ?? { price: i.catalog ? String(i.catalog.price_cents / 100) : '', min: i.catalog ? String(i.catalog.min_quantity) : '1' };
              const price = Math.round(parseFloat(d.price.replace(',', '.')) * 100);
              const ok = price > 0 && Number.isInteger(Number(d.min)) && Number(d.min) >= 1;
              const active = !!i.catalog?.active;
              return (
                <tr key={i.id} className={active ? '' : 'opacity-80'}>
                  <td className="px-3 py-2"><p className="font-medium">{i.name}</p>{active && <Badge variant="success" className="text-[10px]">Au catalogue</Badge>}</td>
                  <td className="px-3 py-2 text-right">{i.quantity}</td>
                  <td className="hidden sm:table-cell px-3 py-2 text-right whitespace-nowrap text-muted-foreground">{formatCurrency(i.unit_price_cents, i.currency)}</td>
                  <td className="px-3 py-2"><Input aria-label={`Prix entreprises ${i.name}`} className="h-9 w-28" inputMode="decimal" placeholder={i.currency} value={d.price} onChange={(e) => setDraft({ ...draft, [i.id]: { ...d, price: e.target.value } })} /></td>
                  <td className="px-3 py-2"><Input aria-label={`Quantité minimum ${i.name}`} className="h-9 w-16" inputMode="numeric" value={d.min} onChange={(e) => setDraft({ ...draft, [i.id]: { ...d, min: e.target.value } })} /></td>
                  <td className="px-3 py-2 whitespace-nowrap text-right">
                    <Button size="sm" disabled={!ok || save.isPending} onClick={() => save.mutate({ id: i.id, body: { price_cents: price, min_quantity: Number(d.min), active: true } })}>
                      {active ? 'Mettre à jour' : 'Ajouter'}
                    </Button>
                    {active && (
                      <Button size="sm" variant="ghost" className="ml-1" disabled={save.isPending} onClick={() => save.mutate({ id: i.id, body: { price_cents: i.catalog.price_cents, min_quantity: i.catalog.min_quantity, active: false } })} title="Retirer du catalogue">
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && !isLoading && <p className="px-3 py-6 text-sm text-muted-foreground text-center">Aucun article dans le stock de cette station.</p>}
      </div>
    </div>
  );
}

/** Enterprises that invited us: accept / refuse; the accepted ones (end the link). */
function Clients({ orgId }: { orgId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['supplier-links', orgId], queryFn: async () => (await api.get(`/organizations/${orgId}/supplier-links`)).data });
  const decide = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => (await api.put(`/organizations/${orgId}/supplier-links/${id}`, { action })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplier-links', orgId] }),
  });
  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />;
  const clients = (data?.clients || []).filter((c: any) => c.status === 'pending' || c.status === 'accepted');
  if (!clients.length) return <EmptyState icon={Store} title="Pas encore de client" text="Donnez votre numéro de fournisseur aux entreprises : elles vous invitent depuis « Mes fournisseurs », vous acceptez ici." />;
  return (
    <div className="space-y-3">
      {decide.isError && <p className="text-sm text-destructive">{msg(decide.error)}</p>}
      {clients.map((c: any) => (
        <Card key={c.id}>
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">{c.client_name}</p>
              <p className="text-xs text-muted-foreground">{c.status === 'pending' ? `Demande du ${formatDate(c.created_at)}` : `Client depuis le ${formatDate(c.decided_at || c.created_at)}`}{c.message ? ` · « ${c.message} »` : ''}</p>
            </div>
            {c.status === 'pending' ? (
              <div className="flex gap-2">
                <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate({ id: c.id, action: 'accept' })}><Check className="mr-1 w-4 h-4" /> Accepter</Button>
                <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ id: c.id, action: 'refuse' })}>Refuser</Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" className="text-destructive" disabled={decide.isPending} onClick={() => window.confirm(`Ne plus servir ${c.client_name} ?`) && decide.mutate({ id: c.id, action: 'end' })}>Mettre fin</Button>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

const ORDER_FILTERS = [['', 'Toutes'], ['submitted', 'À confirmer'], ['confirmed', 'Attendent le paiement'], ['paid', 'À livrer'], ['delivered', 'Livrées'], ['received', 'Terminées']] as const;

function ReceivedOrders({ orgId, stations }: { orgId: string; stations: any[] }) {
  // Each order's default delivery fee is the one of the station that serves it.
  const feeOf = (merchantId: string) => {
    const st = stations.find((x) => x.merchant_id === merchantId);
    return { cents: st?.default_delivery_fee_cents ?? null, currency: st?.default_delivery_currency ?? null };
  };
  const [filter, setFilter] = useState('');
  const { data: orders, isLoading } = useQuery({
    queryKey: ['supplier-orders', orgId, 'supplier', filter],
    queryFn: async () => (await api.get(`/organizations/${orgId}/supplier-orders`, { params: { side: 'supplier', ...(filter ? { status: filter } : {}) } })).data as any[],
    refetchInterval: 30_000,
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {ORDER_FILTERS.map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={cn('rounded-full border px-3 py-1 text-xs font-medium', filter === k ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground')}>{label}</button>
        ))}
      </div>
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : !orders?.length ? (
        <EmptyState icon={Truck} title="Aucune commande" text="Les commandes de vos clients arrivent ici (et en notification)." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {orders.map((o) => <OrderCard key={o.id} order={o} side="supplier" orgId={orgId} defaultFee={feeOf(o.supplier_merchant_id)} />)}
        </div>
      )}
    </div>
  );
}
