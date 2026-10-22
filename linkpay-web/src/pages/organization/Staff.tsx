import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/PageHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PhoneInput } from '@/components/PhoneInput';
import { toApiPhone } from '@/lib/mobile-money';
import { downloadStaffCredentialPdf } from '@/lib/staff-credential-pdf';
import { Loader2, Plus, X, Printer, KeyRound, Warehouse, ShoppingBag, Calculator, UserX, UserCheck, BadgeCheck } from 'lucide-react';

// One person sells AND takes the money, in every sector (our shops don't split seller and cashier): a single
// « Vendeur / caissier » role (slug 'caissier'). A vendeur from before migration 077 is shown as one.
const ROLES = [
  { slug: 'caissier', label: 'Vendeur / caissier', icon: ShoppingBag },
  { slug: 'gerant', label: 'Gérant', icon: BadgeCheck },
  { slug: 'magasinier', label: 'Magasinier', icon: Warehouse },
  { slug: 'comptable', label: 'Comptable', icon: Calculator },
];
const roleOf = (member: any) => (member.role === 'vendeur' ? 'caissier' : member.role);

const EMPTY_FORM = { nom: '', postnom: '', prenom: '', telephone: '', email: '', role_slug: 'caissier', merchant_id: '' };

/** "ABC · Station Gombe" on the credentials sheet, so the person knows where they work. */
function stationLabel(orgName: string, station?: string | null) {
  return station ? `${orgName} · ${station}` : orgName;
}

/**
 * The business's staff. Every person works in one station. The owner staffs
 * every station and names the managers; a station manager (gerant) sees and
 * staffs their own station only, never another manager. The API enforces
 * the same rules.
 */
export default function StaffPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isOwner = user?.role === 'enterprise' || !!user?.acting_as_org_id;
  const [searchParams] = useSearchParams();
  const [showAdd, setShowAdd] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [stationFilter, setStationFilter] = useState<string>(() => searchParams.get('station') || '');
  const [form, setForm] = useState(EMPTY_FORM);
  const [reprintingId, setReprintingId] = useState<string | null>(null);

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
  });

  // A manager can't name managers.
  const assignableRoles = isOwner ? ROLES : ROLES.filter((r) => r.slug !== 'gerant');

  const { data: stations } = useQuery({
    queryKey: ['org-merchants', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/merchants`)).data as { id: string; name: string }[],
    enabled: !!org?.id && isOwner,
  });
  const stationName = (id?: string | null) => stations?.find((st) => st.id === id)?.name;
  // The station a new person joins: the one chosen, the filtered one, or the only one there is.
  const formStation = form.merchant_id || stationFilter || (stations?.length === 1 ? stations[0].id : '');

  const { data: staff } = useQuery({
    queryKey: ['org-staff', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/staff`)).data,
    enabled: !!org?.id,
  });

  const createMutation = useMutation({
    mutationFn: async () => (await api.post(`/organizations/${org.id}/staff`, {
      ...form,
      telephone: form.telephone ? toApiPhone(form.telephone) : undefined,
      // A manager's new staff always join the manager's station (the API sets it).
      merchant_id: isOwner ? formStation : undefined,
    })).data,
    onSuccess: async (created) => {
      setShowAdd(false);
      setForm(EMPTY_FORM);
      queryClient.invalidateQueries({ queryKey: ['org-staff', org.id] });
      queryClient.invalidateQueries({ queryKey: ['org-stores-breakdown', org.id] });

      const role = ROLES.find((r) => r.slug === form.role_slug);
      try {
        await downloadStaffCredentialPdf({
          nom: form.nom,
          postnom: form.postnom,
          prenom: form.prenom,
          email: form.email,
          temp_password: created.temp_password,
          role_name: role?.label,
          orgName: stationLabel(org.name, isOwner ? stationName(formStation) : user?.station_name),
        });
      } catch {
        // Cancelled/failed share — the credential is still safely archived
        // server-side (has_temp_password) and reprintable from the list.
      }
    },
  });

  const [resetTarget, setResetTarget] = useState<any>(null);
  const [removeTarget, setRemoveTarget] = useState<any>(null);
  const [roleChange, setRoleChange] = useState<{ member: any; role_slug: string } | null>(null);
  const [stationChange, setStationChange] = useState<{ member: any; merchant_id: string } | null>(null);
  const [actionError, setActionError] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['org-staff', org.id] });
  const fail = (err: any) => setActionError(err?.response?.data?.message || 'Action impossible, réessayez.');

  const changeRoleMutation = useMutation({
    mutationFn: async ({ member, role_slug }: { member: any; role_slug: string }) =>
      api.put(`/organizations/${org.id}/staff/${member.id}/role`, { role_slug }),
    onSuccess: () => { setActionError(''); refresh(); },
    onError: fail,
    onSettled: () => setRoleChange(null),
  });

  const changeStationMutation = useMutation({
    mutationFn: async ({ member, merchant_id }: { member: any; merchant_id: string }) =>
      api.put(`/organizations/${org.id}/staff/${member.id}/station`, { merchant_id }),
    onSuccess: () => {
      setActionError('');
      refresh();
      queryClient.invalidateQueries({ queryKey: ['org-stores-breakdown', org.id] });
    },
    onError: fail,
    onSettled: () => setStationChange(null),
  });

  const removeMutation = useMutation({
    mutationFn: async (member: any) => api.post(`/organizations/${org.id}/staff/${member.id}/deactivate`),
    onSuccess: () => { setActionError(''); refresh(); },
    onError: fail,
    onSettled: () => setRemoveTarget(null),
  });

  const restoreMutation = useMutation({
    mutationFn: async (member: any) => (await api.post(`/organizations/${org.id}/staff/${member.id}/reactivate`)).data,
    onSuccess: async (data, member) => { setActionError(''); refresh(); await printCredential(data, member); },
    onError: fail,
  });

  const printCredential = async (data: any, member: any) => {
    const role = ROLES.find((r) => r.slug === roleOf(member));
    try {
      await downloadStaffCredentialPdf({
        nom: data.nom,
        postnom: data.postnom,
        prenom: data.prenom,
        email: data.email,
        temp_password: data.temp_password,
        role_name: role?.label,
        orgName: stationLabel(org.name, member.station_name),
      });
    } catch {
      // Cancelled share sheet — nothing else depends on it here.
    }
  };

  const reprint = async (member: any) => {
    setReprintingId(member.id);
    try {
      const { data } = await api.get(`/organizations/${org.id}/staff/${member.id}/reprint`);
      await printCredential(data, member);
    } finally {
      setReprintingId(null);
    }
  };

  const resetPassword = async (member: any) => {
    setReprintingId(member.id);
    try {
      const { data } = await api.post(`/organizations/${org.id}/staff/${member.id}/reset-password`);
      queryClient.invalidateQueries({ queryKey: ['org-staff', org.id] });
      await printCredential(data, member);
    } finally {
      setReprintingId(null);
      setResetTarget(null);
    }
  };

  const inStation = stationFilter ? (staff || []).filter((s: any) => s.merchant_id === stationFilter) : (staff || []);
  const counts = ROLES.reduce((acc: Record<string, number>, r) => {
    acc[r.slug] = inStation.filter((s: any) => roleOf(s) === r.slug).length;
    return acc;
  }, {});
  const visibleStaff = roleFilter ? inStation.filter((s: any) => roleOf(s) === roleFilter) : inStation;
  const unassigned = (staff || []).filter((s: any) => !s.merchant_id && s.active !== false).length;
  const canActOn = (member: any) => isOwner || member.role !== 'gerant';

  // Group by station when owner sees all stations (no filter active, multiple stations)
  const grouped: { stationId: string | null; stationName: string; members: any[] }[] =
    isOwner && !stationFilter && stations && stations.length > 1
      ? (() => {
          const map = new Map<string, any[]>();
          for (const s of visibleStaff) {
            const key = s.merchant_id || '__none__';
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(s);
          }
          const result: { stationId: string | null; stationName: string; members: any[] }[] = stations
            .map((st) => ({ stationId: st.id as string | null, stationName: st.name, members: map.get(st.id) || [] }))
            .filter((g) => g.members.length > 0);
          const none = map.get('__none__') || [];
          if (none.length) result.push({ stationId: null, stationName: 'Sans station', members: none });
          return result;
        })()
      : [];

  const renderMember = (s: any) => (
    <div key={s.id} className={`py-3 border-b border-border last:border-0 ${s.active === false ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-bold text-primary uppercase">
              {(s.prenom?.[0] || '') + (s.nom?.[0] || '')}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-foreground truncate text-sm">
                {[s.prenom, s.postnom, s.nom].filter(Boolean).join(' ')}
              </p>
              {s.active === false && (
                <span className="text-[11px] font-medium rounded-full bg-destructive/10 text-destructive px-2 py-0.5 flex-shrink-0">Accès retiré</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {[s.role_name || s.role, (!isOwner || stationFilter) ? null : s.station_name, s.email].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        {canActOn(s) && (
          <div className="flex items-center flex-shrink-0 gap-0.5">
            {s.active === false ? (
              <Button variant="outline" size="sm" disabled={restoreMutation.isPending && restoreMutation.variables?.id === s.id} onClick={() => restoreMutation.mutate(s)}>
                {restoreMutation.isPending && restoreMutation.variables?.id === s.id
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <><UserCheck className="w-3.5 h-3.5 mr-1" />Rétablir</>}
              </Button>
            ) : (
              <>
                {s.has_temp_password ? (
                  <Button variant="ghost" size="icon" title="Ré-imprimer le mot de passe temporaire" disabled={reprintingId === s.id} onClick={() => reprint(s)}>
                    {reprintingId === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4 text-muted-foreground" />}
                  </Button>
                ) : (
                  <Button variant="ghost" size="icon" title="Réinitialiser le mot de passe" disabled={reprintingId === s.id} onClick={() => setResetTarget(s)}>
                    {reprintingId === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4 text-muted-foreground" />}
                  </Button>
                )}
                <Button variant="ghost" size="icon" title="Retirer l'accès" onClick={() => setRemoveTarget(s)}>
                  <UserX className="w-4 h-4 text-destructive" />
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {s.active !== false && canActOn(s) && (
        <div className="mt-2 ml-12 flex items-center gap-2 flex-wrap">
          <Select
            value={roleOf(s) || ''}
            onChange={(e) => e.target.value !== roleOf(s) && setRoleChange({ member: s, role_slug: e.target.value })}
            className="h-8 text-xs w-40"
          >
            {ROLES.filter((r) => assignableRoles.includes(r) || r.slug === roleOf(s)).map((r) => (
              <option key={r.slug} value={r.slug} disabled={!assignableRoles.includes(r)}>{r.label}</option>
            ))}
          </Select>
          {isOwner && stations && (
            <Select
              value={s.merchant_id || ''}
              onChange={(e) => e.target.value && e.target.value !== s.merchant_id && setStationChange({ member: s, merchant_id: e.target.value })}
              className="h-8 text-xs w-40"
            >
              {!s.merchant_id && <option value="">Sans station</option>}
              {stations.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
            </Select>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <PageHeader title={isOwner ? 'Utilisateurs internes' : `Employés · ${user?.station_name || 'ma station'}`} />

      {isOwner && stations && stations.length > 1 && (
        <Select aria-label="Station" value={stationFilter} onChange={(e) => setStationFilter(e.target.value)}>
          <option value="">Toutes les stations</option>
          {stations.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
        </Select>
      )}

      {isOwner && unassigned > 0 && (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {unassigned === 1
            ? "1 employé n'a pas encore de station : il ne peut rien faire tant que vous ne l'y affectez pas (champ « Station » ci-dessous)."
            : `${unassigned} employés n'ont pas encore de station : ils ne peuvent rien faire tant que vous ne les y affectez pas (champ « Station » ci-dessous).`}
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {ROLES.filter((r) => assignableRoles.includes(r) || counts[r.slug]).map((r) => (
          <button
            key={r.slug}
            type="button"
            onClick={() => setRoleFilter(roleFilter === r.slug ? null : r.slug)}
            className={`rounded-2xl border-2 p-4 text-left transition-colors ${
              roleFilter === r.slug ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent/50'
            }`}
          >
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-2">
              <r.icon className="w-5 h-5 text-primary" />
            </div>
            <p className="text-xl font-bold text-foreground">{counts[r.slug] || 0}</p>
            <p className="text-sm text-muted-foreground">{r.label}</p>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{roleFilter ? ROLES.find((r) => r.slug === roleFilter)?.label : 'Tous les utilisateurs'}</CardTitle>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="mr-1 w-4 h-4" />
            Ajouter
          </Button>
        </CardHeader>
        <CardContent>
          {showAdd && (
            <div className="rounded-2xl border border-border bg-card/50 p-4 mb-5 space-y-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-foreground">Nouvel utilisateur</p>
                <button onClick={() => setShowAdd(false)} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Identité */}
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Identité</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="staff_prenom">Prénom</Label>
                    <Input id="staff_prenom" value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="staff_nom">Nom</Label>
                    <Input id="staff_nom" value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="staff_postnom">Postnom</Label>
                  <Input id="staff_postnom" value={form.postnom} onChange={(e) => setForm({ ...form, postnom: e.target.value })} />
                </div>
              </div>

              {/* Contact */}
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Contact</p>
                <div className="space-y-1.5">
                  <Label htmlFor="staff_telephone">
                    Téléphone <span className="text-muted-foreground font-normal">(optionnel)</span>
                  </Label>
                  <PhoneInput id="staff_telephone" value={form.telephone} onChange={(digits) => setForm({ ...form, telephone: digits })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="staff_email">Email</Label>
                  <Input id="staff_email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
              </div>

              {/* Accès */}
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Accès</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="staff_role">Rôle</Label>
                    <Select id="staff_role" value={form.role_slug} onChange={(e) => setForm({ ...form, role_slug: e.target.value })}>
                      {assignableRoles.map((r) => (
                        <option key={r.slug} value={r.slug}>{r.label}</option>
                      ))}
                    </Select>
                  </div>
                  {isOwner ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="staff_station">Station</Label>
                      <Select id="staff_station" value={formStation} onChange={(e) => setForm({ ...form, merchant_id: e.target.value })}>
                        <option value="" disabled>Choisir…</option>
                        {(stations || []).map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                      </Select>
                      {stations && !stations.length && (
                        <p className="text-xs text-muted-foreground">Créez d'abord une station (menu Stations).</p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Label>Station</Label>
                      <p className="h-10 flex items-center text-sm font-medium text-foreground">{user?.station_name}</p>
                    </div>
                  )}
                </div>
              </div>

              {createMutation.isError && (
                <p className="text-sm text-destructive font-medium rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3">
                  {(createMutation.error as any)?.response?.data?.message || "Échec de la création — réessayez."}
                </p>
              )}
              <Button
                className="w-full"
                disabled={!form.nom || !form.prenom || !form.email || (isOwner && !formStation) || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                Enregistrer
              </Button>
            </div>
          )}

          {visibleStaff.length ? (
            <div>
              {actionError && <p className="text-sm text-destructive pb-3">{actionError}</p>}
              {grouped.length > 0
                ? grouped.map((group) => (
                    <div key={group.stationId || '__none__'} className="mb-5 last:mb-0">
                      <div className="flex items-center gap-2 mb-2 px-1">
                        <Warehouse className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider truncate">{group.stationName}</p>
                        <span className="text-xs text-muted-foreground flex-shrink-0">({group.members.length})</span>
                      </div>
                      <div className="rounded-xl border border-border/60 bg-background px-3">
                        {group.members.map(renderMember)}
                      </div>
                    </div>
                  ))
                : <div className="divide-y divide-border">{visibleStaff.map(renderMember)}</div>
              }
            </div>
          ) : (
            !showAdd && <p className="text-muted-foreground text-center py-6 text-sm">Aucun utilisateur pour le moment</p>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Retirer l'accès de cet employé ?"
        description={`${[removeTarget?.prenom, removeTarget?.nom].filter(Boolean).join(' ')} ne pourra plus se connecter et sera déconnecté immédiatement. Ses ventes et son historique sont conservés. Vous pourrez rétablir son accès plus tard. Vous devrez confirmer avec votre code d'accès.`}
        confirmLabel="Retirer l'accès"
        variant="destructive"
        onConfirm={() => removeTarget && removeMutation.mutate(removeTarget)}
      />

      <ConfirmDialog
        open={!!roleChange}
        onOpenChange={(open) => !open && setRoleChange(null)}
        title="Changer le rôle ?"
        description={`${[roleChange?.member?.prenom, roleChange?.member?.nom].filter(Boolean).join(' ')} deviendra ${ROLES.find((r) => r.slug === roleChange?.role_slug)?.label || ''}. Il sera déconnecté et verra les écrans de son nouveau rôle à sa prochaine connexion. Vous devrez confirmer avec votre code d'accès.`}
        confirmLabel="Changer le rôle"
        onConfirm={() => roleChange && changeRoleMutation.mutate(roleChange)}
      />

      <ConfirmDialog
        open={!!stationChange}
        onOpenChange={(open) => !open && setStationChange(null)}
        title="Changer de station ?"
        description={`${[stationChange?.member?.prenom, stationChange?.member?.nom].filter(Boolean).join(' ')} travaillera à la station « ${stationName(stationChange?.merchant_id) || ''} ». Il sera déconnecté et ne verra plus que cette station à sa prochaine connexion. Vous devrez confirmer avec votre code d'accès.`}
        confirmLabel="Changer de station"
        onConfirm={() => stationChange && changeStationMutation.mutate(stationChange)}
      />

      <ConfirmDialog
        open={!!resetTarget}
        onOpenChange={(open) => !open && setResetTarget(null)}
        title="Réinitialiser le mot de passe ?"
        description={`Un nouveau mot de passe temporaire sera généré pour ${[resetTarget?.prenom, resetTarget?.nom].filter(Boolean).join(' ')}, qui devra le changer à la prochaine connexion. Sa session actuelle (autre appareil) sera libérée.`}
        confirmLabel="Réinitialiser"
        onConfirm={() => resetPassword(resetTarget)}
      />
    </div>
  );
}
