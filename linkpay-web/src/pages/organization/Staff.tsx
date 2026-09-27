import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/PageHeader';
import { downloadStaffCredentialPdf } from '@/lib/staff-credential-pdf';
import { Loader2, Plus, X, Printer, Warehouse, ShoppingBag, Wallet, Calculator } from 'lucide-react';

const ROLES = [
  { slug: 'magasinier', label: 'Magasinier', icon: Warehouse },
  { slug: 'vendeur', label: 'Vendeur', icon: ShoppingBag },
  { slug: 'caissier', label: 'Caissier', icon: Wallet },
  { slug: 'comptable', label: 'Comptable', icon: Calculator },
];

export default function StaffPage() {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [form, setForm] = useState({ nom: '', postnom: '', prenom: '', telephone: '', email: '', role_slug: 'vendeur' });
  const [reprintingId, setReprintingId] = useState<string | null>(null);

  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
  });

  const { data: staff } = useQuery({
    queryKey: ['org-staff', org?.id],
    queryFn: async () => (await api.get(`/organizations/${org.id}/staff`)).data,
    enabled: !!org?.id,
  });

  const createMutation = useMutation({
    mutationFn: async () => (await api.post(`/organizations/${org.id}/staff`, form)).data,
    onSuccess: async (created) => {
      setShowAdd(false);
      setForm({ nom: '', postnom: '', prenom: '', telephone: '', email: '', role_slug: 'vendeur' });
      queryClient.invalidateQueries({ queryKey: ['org-staff', org.id] });

      // The user is created either way — the PDF/share is a courtesy on
      // top, not a condition for it. Share.share() rejects with "Share
      // canceled" whenever the admin dismisses the native chooser instead
      // of picking an app, which must never block the state updates above
      // (it used to run first and `await`ed, so a cancel there left the
      // dialog open and the new user invisible until a manual refresh).
      const role = ROLES.find((r) => r.slug === form.role_slug);
      try {
        await downloadStaffCredentialPdf({
          nom: form.nom,
          postnom: form.postnom,
          prenom: form.prenom,
          email: form.email,
          temp_password: created.temp_password,
          role_name: role?.label,
          orgName: org.name,
        });
      } catch {
        // Cancelled/failed share — the credential is still safely archived
        // server-side (has_temp_password) and reprintable from the list.
      }
    },
  });

  const reprint = async (member: any) => {
    setReprintingId(member.id);
    try {
      const { data } = await api.get(`/organizations/${org.id}/staff/${member.id}/reprint`);
      const role = ROLES.find((r) => r.slug === member.role);
      try {
        await downloadStaffCredentialPdf({
          nom: data.nom,
          postnom: data.postnom,
          prenom: data.prenom,
          email: data.email,
          temp_password: data.temp_password,
          role_name: role?.label,
          orgName: org.name,
        });
      } catch {
        // Cancelled share sheet — nothing else depends on it here.
      }
    } finally {
      setReprintingId(null);
    }
  };

  const counts = ROLES.reduce((acc: Record<string, number>, r) => {
    acc[r.slug] = (staff || []).filter((s: any) => s.role === r.slug).length;
    return acc;
  }, {});

  const visibleStaff = roleFilter ? (staff || []).filter((s: any) => s.role === roleFilter) : (staff || []);

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <PageHeader title="Utilisateurs internes" />

      <div className="grid grid-cols-2 gap-3">
        {ROLES.map((r) => (
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
            <div className="rounded-xl border border-border p-4 mb-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-foreground text-sm">Nouvel utilisateur</p>
                <button onClick={() => setShowAdd(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="staff_prenom">Prénom</Label>
                  <Input id="staff_prenom" value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="staff_nom">Nom</Label>
                  <Input id="staff_nom" value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff_postnom">Postnom</Label>
                <Input id="staff_postnom" value={form.postnom} onChange={(e) => setForm({ ...form, postnom: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff_telephone">Téléphone</Label>
                <Input id="staff_telephone" placeholder="+243 8XX XXX XXX" value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff_email">Email</Label>
                <Input id="staff_email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff_role">Rôle</Label>
                <Select id="staff_role" value={form.role_slug} onChange={(e) => setForm({ ...form, role_slug: e.target.value })}>
                  {ROLES.map((r) => (
                    <option key={r.slug} value={r.slug}>{r.label}</option>
                  ))}
                </Select>
              </div>
              <Button
                className="w-full"
                disabled={!form.nom || !form.prenom || !form.email || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                Enregistrer
              </Button>
            </div>
          )}

          {visibleStaff.length ? (
            <div>
              {visibleStaff.map((s: any) => (
                <div key={s.id} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">{[s.prenom, s.postnom, s.nom].filter(Boolean).join(' ')}</p>
                    <p className="text-sm text-muted-foreground truncate">{s.role_name || s.role} · {s.email}</p>
                  </div>
                  {s.has_temp_password ? (
                    <Button variant="ghost" size="icon" disabled={reprintingId === s.id} onClick={() => reprint(s)}>
                      {reprintingId === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4 text-muted-foreground" />}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground flex-shrink-0">Mot de passe défini</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            !showAdd && <p className="text-muted-foreground text-center py-6">Aucun utilisateur pour le moment</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
