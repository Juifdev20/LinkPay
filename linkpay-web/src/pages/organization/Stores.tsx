import { EmptyState } from '@/components/EmptyState';
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
import { useStationScope } from '@/lib/station-scope';
import { formatCurrency } from '@/lib/utils';
import { Store, Plus, X, Loader2, LayoutDashboard, LogIn, Users, Pencil, Check } from 'lucide-react';

/**
 * The business's stations (its stores). The owner creates them, then staffs
 * each one from Utilisateurs internes; from here they open a station's
 * dashboard, or step into it to work its till as that station.
 */
export default function StoresPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const enterStore = useAuthStore((s) => s.enterStore);
  const [showCreate, setShowCreate] = useState(false);
  const [newStore, setNewStore] = useState({ name: '', phone: '', city: '', default_currency: 'CDF' as 'CDF' | 'USD' });
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const setStation = useStationScope((s) => s.setStation);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  // Just created while the business is a supplier: ask whether it also sells to enterprises (DECISIONS.md 23/10).
  const [justCreated, setJustCreated] = useState<{ id: string; name: string } | null>(null);

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
  });

  const { data: merchants, isLoading } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data,
    enabled: !!org?.id,
  });

  // Today's takings and head count per station.
  const { data: breakdown } = useQuery({
    queryKey: ['org-stores-breakdown', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/stores-breakdown`)).data as any[],
    enabled: !!org?.id,
  });
  const summaryOf = (id: string) => breakdown?.find((b) => b.merchant_id === id);

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

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) =>
      (await api.patch(`/organizations/${org.id}/merchants/${id}`, { name })).data,
    onSuccess: () => {
      setRenaming(null);
      queryClient.invalidateQueries({ queryKey: ['org-merchants', org.id] });
      queryClient.invalidateQueries({ queryKey: ['org-stores-breakdown', org.id] });
    },
  });

  const { data: supplier } = useQuery({
    queryKey: ['supplier-profile', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/supplier-profile`)).data,
    enabled: !!org?.id,
    retry: false,
  });
  const isSupplier = !!supplier?.profile;
  const sellMutation = useMutation({
    mutationFn: async (merchantId: string) => (await api.put(`/organizations/${org.id}/supplier-stations/${merchantId}`, { active: true })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['supplier-profile', org.id] }),
  });

  const createStoreMutation = useMutation({
    mutationFn: async () => (await api.post(`/organizations/${org.id}/merchants`, newStore)).data,
    onSuccess: (res: any) => {
      if (isSupplier && res?.merchant?.id) setJustCreated({ id: res.merchant.id, name: res.merchant.name || newStore.name });
      setShowCreate(false);
      setNewStore({ name: '', phone: '', city: '', default_currency: 'CDF' });
      queryClient.invalidateQueries({ queryKey: ['org-merchants', org.id] });
      queryClient.invalidateQueries({ queryKey: ['org-stores-breakdown', org.id] });
    },
  });

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <PageHeader title="Stations" />

      {justCreated && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-4 space-y-3">
            {sellMutation.isSuccess ? (
              <>
                <p className="text-sm"><strong>{justCreated.name}</strong> vend maintenant aux entreprises. Remplissez son catalogue pour que vos clients puissent y commander.</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => navigate(`/dashboard/organization/supplier?onglet=catalogue&station=${justCreated.id}`)}>Remplir son catalogue</Button>
                  <Button size="sm" variant="ghost" onClick={() => setJustCreated(null)}>Fermer</Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm">
                  Station <strong>{justCreated.name}</strong> créée. Vous êtes fournisseur : voulez-vous qu’elle <strong>vende aussi aux entreprises</strong> ?
                  Elle aura son propre catalogue, tiré de son stock. L’abonnement Fournisseur ne change pas.
                </p>
                {sellMutation.isError && <p className="text-sm text-destructive">{(sellMutation.error as any)?.response?.data?.message || 'Impossible pour le moment, réessayez.'}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={sellMutation.isPending} onClick={() => sellMutation.mutate(justCreated.id)}>
                    {sellMutation.isPending && <Loader2 className="mr-1 w-4 h-4 animate-spin" />} Oui, elle vend aussi
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setJustCreated(null)}>Plus tard</Button>
                </div>
                <p className="text-xs text-muted-foreground">Vous pourrez toujours la cocher ou la décocher dans Espace fournisseur → Abonnement et fiche.</p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Vos stations</CardTitle>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1 w-4 h-4" />
            Créer une station
          </Button>
        </CardHeader>
        <CardContent>
          {showCreate && (
            <div className="rounded-xl border border-border p-4 mb-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-foreground text-sm">Nouvelle station</p>
                <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new_store_name">Nom de la station</Label>
                <Input
                  id="new_store_name"
                  placeholder="Station Gombe"
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
                Créer la station
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : merchants?.length ? (
            // Computer: one tile per station, two per row.
            <div className="lg:grid lg:grid-cols-2 lg:gap-4">
              {merchants.map((m: any) => {
                const summary = summaryOf(m.id);
                const today = summary?.today_pos_sales || {};
                const editing = renaming?.id === m.id ? renaming : null;
                return (
                  <div key={m.id} className="py-3 border-b border-border last:border-0 lg:rounded-2xl lg:border lg:p-4 lg:last:border">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Store className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        {editing ? (
                          <form
                            className="flex items-center gap-1"
                            onSubmit={(e) => { e.preventDefault(); if (editing.name.trim()) renameMutation.mutate(editing); }}
                          >
                            <Input
                              autoFocus
                              aria-label="Nouveau nom de la station"
                              value={editing.name}
                              onChange={(e) => setRenaming({ id: m.id, name: e.target.value })}
                              className="h-8"
                            />
                            <Button type="submit" size="icon" variant="ghost" className="h-8 w-8 flex-shrink-0" disabled={!editing.name.trim() || renameMutation.isPending} title="Enregistrer">
                              {renameMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4 text-primary" />}
                            </Button>
                            <Button type="button" size="icon" variant="ghost" className="h-8 w-8 flex-shrink-0" onClick={() => setRenaming(null)} title="Annuler">
                              <X className="w-4 h-4" />
                            </Button>
                          </form>
                        ) : (
                          <p className="font-semibold truncate text-foreground">{m.name}</p>
                        )}
                        <p className="text-sm text-muted-foreground truncate">
                          {[m.city, summary ? `${summary.staff_count} employé${summary.staff_count > 1 ? 's' : ''}` : null].filter(Boolean).join(' · ') || m.default_currency}
                        </p>
                      </div>
                      {m.status && (
                        <Badge variant={m.status === 'active' ? 'success' : m.status === 'rejected' || m.status === 'suspended' ? 'error' : 'warning'} className="flex-shrink-0">
                          {({ active: 'Ouverte', pending: 'En attente', suspended: 'Suspendue', rejected: 'Refusée' } as Record<string, string>)[m.status] ?? m.status}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 ml-[3.25rem] text-sm">
                      <span className="text-muted-foreground">Recette du jour : </span>
                      <span className="font-semibold text-foreground">{formatCurrency(today.CDF || 0, 'CDF')}</span>
                      <span className="text-muted-foreground"> · </span>
                      <span className="font-semibold text-foreground">{formatCurrency(today.USD || 0, 'USD')}</span>
                    </div>
                    {editing && renameMutation.isError && (
                      <p className="mt-1 ml-[3.25rem] text-xs text-destructive">
                        {(renameMutation.error as any)?.response?.data?.message || 'Impossible de renommer, réessayez.'}
                      </p>
                    )}
                    <div className="mt-2 ml-[3.25rem] flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setStation(m.id); navigate('/dashboard'); }}>
                        <LayoutDashboard className="mr-1 w-4 h-4" /> Tableau de bord
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => navigate(`/dashboard/organization/staff?station=${m.id}`)}>
                        <Users className="mr-1 w-4 h-4" /> Employés
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { renameMutation.reset(); setRenaming({ id: m.id, name: m.name }); }}>
                        <Pencil className="mr-1 w-4 h-4" /> Renommer
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => enterMutation.mutate(m.id)} disabled={enteringId === m.id}>
                        {enteringId === m.id ? <Loader2 className="mr-1 w-4 h-4 animate-spin" /> : <LogIn className="mr-1 w-4 h-4" />} Entrer
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            !showCreate && <EmptyState icon={Store} title="Aucune station pour le moment" text="Une station = un point de vente (caisse, stock, employés). Créez la première avec le bouton ci-dessus." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
