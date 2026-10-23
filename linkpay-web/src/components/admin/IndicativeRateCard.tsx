import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDate } from '@/lib/utils';

/** Super admin: the indicative CDF/USD rate shown under amounts ("≈ 5,12 $US"). Display only, never converts money. */
export function IndicativeRateCard() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['admin-platform-settings'],
    queryFn: async () => (await api.get('/admin/platform-settings')).data,
  });
  const [value, setValue] = useState('');
  useEffect(() => {
    if (data) setValue(data.cdf_per_usd != null ? String(data.cdf_per_usd) : '');
  }, [data]);

  const mutation = useMutation({
    mutationFn: async () => (await api.put('/admin/platform-settings', { cdf_per_usd: value.trim() ? Number(value.replace(',', '.')) : null })).data,
    onSuccess: (saved) => {
      queryClient.setQueryData(['admin-platform-settings'], saved);
      queryClient.invalidateQueries({ queryKey: ['platform-settings-public'] });
    },
  });
  const error = (mutation.error as any)?.response?.data?.message;
  const parsed = Number(value.replace(',', '.'));
  const invalid = value.trim() !== '' && (!Number.isFinite(parsed) || parsed < 1);

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ArrowLeftRight className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-foreground">Taux indicatif CDF / USD</p>
          <p className="text-sm text-muted-foreground">
            Affiché sous les montants (« ≈ 5,12 $US ») pour aider les clients. Il ne convertit jamais rien : les soldes CDF et USD restent séparés. Vide = pas d'affichage.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">1 USD =</span>
        <Input inputMode="decimal" placeholder="ex. 2850" value={value} onChange={(e) => setValue(e.target.value)} className="max-w-[10rem]" />
        <span className="text-sm font-medium text-muted-foreground">CDF</span>
        <Button className="ml-auto" disabled={invalid || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Enregistrer
        </Button>
      </div>
      {invalid && <p className="text-xs text-destructive">Saisissez un nombre positif (ex. 2850).</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {mutation.isSuccess && <p className="text-xs text-success">Taux enregistré.</p>}
      {data?.updated_at && <p className="text-xs text-muted-foreground">Dernière modification des réglages : {formatDate(data.updated_at)}</p>}
    </div>
  );
}
