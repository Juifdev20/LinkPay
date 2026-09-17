import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CurrencySelector } from '@/components/CurrencySelector';
import { DualCurrencyStat } from '@/components/DualCurrencyStat';
import { Building2, Loader2, Store, Plus, TrendingUp, Receipt, QrCode, Wallet, ChevronRight, X } from 'lucide-react';

export default function OrganizationProfilePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const enterStore = useAuthStore((s) => s.enterStore);
  const [form, setForm] = useState({ name: '', legal_name: '', phone: '', email: '', address: '' });
  const [showCreateStore, setShowCreateStore] = useState(false);
  const [newStore, setNewStore] = useState({ name: '', phone: '', city: '', default_currency: 'CDF' as 'CDF' | 'USD' });
  const [enteringId, setEnteringId] = useState<string | null>(null);

  const { data: org, isLoading } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => {
      const { data } = await api.get('/organizations/me');
      return data;
    },
  });

  useEffect(() => {
    if (org) {
      setForm({
        name: org.name || '',
        legal_name: org.legal_name || '',
        phone: org.contact?.phone || '',
        email: org.contact?.email || '',
        address: org.contact?.address || '',
      });
    }
  }, [org]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      await api.put(`/organizations/${org.id}`, {
        name: form.name,
        legal_name: form.legal_name,
        contact: { phone: form.phone, email: form.email, address: form.address },
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-organization'] }),
  });

  const { data: stats } = useQuery({
    queryKey: ['org-stats', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/stats`)).data,
    enabled: !!org?.id,
  });

  const { data: merchants } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data,
    enabled: !!org?.id,
  });

  const enterMutation = useMutation({
    mutationFn: async (merchantId: string) => {
      setEnteringId(merchantId);
      const { data } = await api.post(`/organizations/${org.id}/merchants/${merchantId}/enter`);
      return data;
    },
    onSuccess: (data) => {
      enterStore(data.merchant, data.access_token, data.refresh_token, data.organization_id);
      navigate('/dashboard');
    },
    onSettled: () => setEnteringId(null),
  });

  const createStoreMutation = useMutation({
    mutationFn: async () => (await api.post(`/organizations/${org.id}/merchants`, newStore)).data,
    onSuccess: (data) => {
      setShowCreateStore(false);
      setNewStore({ name: '', phone: '', city: '', default_currency: 'CDF' });
      queryClient.invalidateQueries({ queryKey: ['org-merchants', org.id] });
      enterMutation.mutate(data.merchant.id);
    },
  });

  const statCards = [
    { label: 'Volume total', money: stats?.volume, icon: TrendingUp },
    { label: 'Transactions', value: String(stats?.total_transactions || 0), icon: Receipt },
    { label: "Aujourd'hui", value: String(stats?.today_transactions || 0), icon: QrCode },
    { label: 'En attente', money: stats?.pending, icon: Wallet },
  ];

  if (isLoading) {
    return (
      <div className="p-6 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Building2 className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Mon organisation</h1>
          {org?.status && (
            <Badge variant={org.status === 'active' ? 'success' : 'warning'} className="mt-1 capitalize">
              {org.status}
            </Badge>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Informations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org_name">Nom</Label>
            <Input id="org_name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org_legal_name">Raison sociale</Label>
            <Input id="org_legal_name" value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org_phone">Téléphone</Label>
            <Input id="org_phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org_email">Email</Label>
            <Input id="org_email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="org_address">Adresse</Label>
            <Input id="org_address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <Button
            className="w-full"
            disabled={!form.name || updateMutation.isPending}
            onClick={() => updateMutation.mutate()}
          >
            {updateMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
            Enregistrer
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((c) => (
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Boutiques</CardTitle>
          <Button size="sm" onClick={() => setShowCreateStore(true)}>
            <Plus className="mr-1 w-4 h-4" />
            Créer une boutique
          </Button>
        </CardHeader>
        <CardContent>
          {showCreateStore && (
            <div className="rounded-xl border border-border p-4 mb-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-foreground text-sm">Nouvelle boutique</p>
                <button onClick={() => setShowCreateStore(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new_store_name">Nom de la boutique</Label>
                <Input
                  id="new_store_name"
                  placeholder="Boutique Mukendi"
                  value={newStore.name}
                  onChange={(e) => setNewStore({ ...newStore, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new_store_phone">Téléphone</Label>
                <Input
                  id="new_store_phone"
                  placeholder="+243 8XX XXX XXX"
                  value={newStore.phone}
                  onChange={(e) => setNewStore({ ...newStore, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new_store_city">Ville</Label>
                <Input
                  id="new_store_city"
                  placeholder="Kinshasa"
                  value={newStore.city}
                  onChange={(e) => setNewStore({ ...newStore, city: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Devise par défaut</Label>
                <CurrencySelector value={newStore.default_currency} onChange={(c) => setNewStore({ ...newStore, default_currency: c })} />
              </div>
              <Button
                className="w-full"
                disabled={!newStore.name || createStoreMutation.isPending}
                onClick={() => createStoreMutation.mutate()}
              >
                {createStoreMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                Créer et ouvrir
              </Button>
            </div>
          )}

          {merchants?.length ? (
            <div>
              {merchants.map((m: any) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => enterMutation.mutate(m.id)}
                  disabled={enteringId === m.id}
                  className="w-full flex items-center justify-between py-3 border-b border-border last:border-0 text-left hover:bg-accent/50 transition-colors -mx-2 px-2 rounded-lg"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Store className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold truncate text-foreground">{m.name}</p>
                      <p className="text-sm text-muted-foreground">{m.city || m.default_currency}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant={m.status === 'active' ? 'success' : m.status === 'rejected' || m.status === 'suspended' ? 'error' : 'warning'} className="capitalize">
                      {m.status}
                    </Badge>
                    {enteringId === m.id ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            !showCreateStore && <p className="text-muted-foreground text-center py-6">Aucune boutique pour le moment</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
