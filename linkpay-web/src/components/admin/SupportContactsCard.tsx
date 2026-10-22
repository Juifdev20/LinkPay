import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Headphones, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const FIELDS = [
  { key: 'support_phone', label: 'Téléphone', placeholder: 'ex. +243 812 345 678', inputMode: 'tel' },
  { key: 'support_whatsapp', label: 'WhatsApp', placeholder: 'ex. +243 812 345 678', inputMode: 'tel' },
  { key: 'support_email', label: 'Email', placeholder: 'ex. support@exemple.cd', inputMode: 'email' },
] as const;
type Key = (typeof FIELDS)[number]['key'];

/** Super admin: the support contacts every user sees in « Aide & support ». An empty field is not shown. */
export function SupportContactsCard() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['admin-platform-settings'],
    queryFn: async () => (await api.get('/admin/platform-settings')).data,
  });
  const [values, setValues] = useState<Record<Key, string>>({ support_phone: '', support_whatsapp: '', support_email: '' });
  useEffect(() => {
    if (data) setValues({ support_phone: data.support_phone ?? '', support_whatsapp: data.support_whatsapp ?? '', support_email: data.support_email ?? '' });
  }, [data]);

  const mutation = useMutation({
    mutationFn: async () => (await api.put('/admin/platform-settings', values)).data,
    onSuccess: (saved) => {
      queryClient.setQueryData(['admin-platform-settings'], saved);
      queryClient.invalidateQueries({ queryKey: ['platform-settings-public'] });
    },
  });
  const error = (mutation.error as any)?.response?.data?.message;

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Headphones className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-foreground">Contacts du support</p>
          <p className="text-sm text-muted-foreground">
            Affichés à tous les utilisateurs dans « Aide & support » et sur l'écran « mot de passe oublié ». Un champ vide n'est pas affiché.
          </p>
        </div>
      </div>
      <form
        className="space-y-3"
        onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}
      >
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={f.key}>{f.label}</Label>
            <Input
              id={f.key}
              inputMode={f.inputMode}
              placeholder={f.placeholder}
              value={values[f.key]}
              onChange={(e) => { mutation.reset(); setValues((v) => ({ ...v, [f.key]: e.target.value })); }}
            />
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Enregistrer
          </Button>
          {mutation.isSuccess && <p className="text-sm text-success">Contacts enregistrés.</p>}
          {error && <p className="text-sm text-destructive">{Array.isArray(error) ? error.join(' ') : error}</p>}
        </div>
      </form>
    </div>
  );
}
