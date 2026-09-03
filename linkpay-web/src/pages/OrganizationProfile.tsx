import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Building2, Loader2 } from 'lucide-react';

export default function OrganizationProfilePage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', legal_name: '', phone: '', email: '', address: '' });

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

      <p className="text-xs text-muted-foreground text-center">
        La gestion multi-boutiques n'est pas encore disponible pour les organisations.
      </p>
    </div>
  );
}
