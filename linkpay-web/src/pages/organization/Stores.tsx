import { useState } from 'react';
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
import { PageHeader } from '@/components/PageHeader';
import { Store, Plus, ChevronRight, X, Loader2 } from 'lucide-react';

export default function StoresPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const enterStore = useAuthStore((s) => s.enterStore);
  const [showCreate, setShowCreate] = useState(false);
  const [newStore, setNewStore] = useState({ name: '', phone: '', city: '', default_currency: 'CDF' as 'CDF' | 'USD' });
  const [enteringId, setEnteringId] = useState<string | null>(null);

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
  });

  const { data: merchants, isLoading } = useQuery({
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
      setShowCreate(false);
      setNewStore({ name: '', phone: '', city: '', default_currency: 'CDF' });
      queryClient.invalidateQueries({ queryKey: ['org-merchants', org.id] });
      enterMutation.mutate(data.merchant.id);
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      <PageHeader title="Boutiques" />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Vos boutiques</CardTitle>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1 w-4 h-4" />
            Créer une boutique
          </Button>
        </CardHeader>
        <CardContent>
          {showCreate && (
            <div className="rounded-xl border border-border p-4 mb-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-foreground text-sm">Nouvelle boutique</p>
                <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : merchants?.length ? (
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
            !showCreate && <p className="text-muted-foreground text-center py-6">Aucune boutique pour le moment</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
