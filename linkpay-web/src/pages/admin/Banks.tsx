import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Landmark, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface BankRow {
  name: string;
  enabled: boolean;
}

/**
 * Banks offered for withdrawals and merchant settlements — super admin only. Customers can pick ONLY the banks switched on here
 * (they never type a bank's name), so every account number is read with the rules of a known bank.
 */
export default function BanksPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<{ banks: BankRow[] }>({
    queryKey: ['admin-banks'],
    queryFn: async () => (await api.get('/admin/banks')).data,
  });

  useEffect(() => {
    if (data) setSelected(new Set(data.banks.filter((b) => b.enabled).map((b) => b.name)));
  }, [data]);

  const save = useMutation({
    mutationFn: async () => (await api.put('/admin/banks', { banks: [...selected] })).data,
    onSuccess: (saved) => {
      queryClient.setQueryData(['admin-banks'], saved);
      queryClient.invalidateQueries({ queryKey: ['platform-banks'] });
    },
  });

  const banks = data?.banks ?? [];
  const saved = new Set(banks.filter((b) => b.enabled).map((b) => b.name));
  const changed = selected.size !== saved.size || [...selected].some((n) => !saved.has(n));
  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 md:p-6">
      <PageHeader title="Banques de retrait" />
      <p className="text-sm text-muted-foreground">
        Cochez les banques que les clients, marchands, patrons et entreprises peuvent choisir pour retirer leur argent vers un compte bancaire.
        Ils ne peuvent pas saisir une autre banque : le numéro de compte est contrôlé selon la banque choisie.
      </p>

      {isLoading ? (
        <div className="py-16"><Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        <div className="space-y-2">
          {banks.map((b) => {
            const on = selected.has(b.name);
            return (
              <button
                key={b.name}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(b.name)}
                className={cn('flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-colors', on ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-accent')}
              >
                <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', on ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                  <Landmark className="h-5 w-5" />
                </span>
                <span className="flex-1 font-semibold text-foreground">{b.name}</span>
                <span className={cn('flex h-6 w-6 items-center justify-center rounded-full border-2', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input')}>
                  {on && <Check className="h-4 w-4" />}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {selected.size === 0 && !isLoading && <p className="text-sm font-medium text-destructive">Gardez au moins une banque.</p>}
      {save.isError && <p className="text-sm font-medium text-destructive" role="alert">{(save.error as any)?.response?.data?.message || "L'enregistrement a échoué."}</p>}
      {save.isSuccess && !changed && <p className="text-sm font-medium text-success">Enregistré. Les clients voient maintenant {selected.size} banque{selected.size > 1 ? 's' : ''}.</p>}

      <Button className="w-full" size="lg" disabled={!changed || selected.size === 0 || save.isPending} onClick={() => save.mutate()}>
        {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Enregistrer ({selected.size} sélectionnée{selected.size > 1 ? 's' : ''})
      </Button>
    </div>
  );
}
