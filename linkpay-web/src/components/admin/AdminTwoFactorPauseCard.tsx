import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { cn, formatDate } from '@/lib/utils';

/** The API's choices (never "for ever": a suspension forgotten before the launch would stay). */
const DURATIONS = [
  { hours: 1, label: '1 heure' },
  { hours: 24, label: '24 heures' },
  { hours: 24 * 7, label: '7 jours' },
  { hours: 24 * 30, label: '30 jours' },
];

/**
 * Super admin: suspend the administrators' second factor for a while (development), or turn it back on (migration
 * 081). While suspended the password is enough to enter the administration; it comes back on by itself at the end.
 */
export function AdminTwoFactorPauseCard() {
  const queryClient = useQueryClient();
  const fetchProfile = useAuthStore((s) => s.fetchProfile);
  const [hours, setHours] = useState(24);
  const [confirm, setConfirm] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-platform-settings'],
    queryFn: async () => (await api.get('/admin/platform-settings')).data,
  });
  const pausedUntil: string | null = data?.admin_2fa_paused_until ?? null;

  const mutation = useMutation({
    mutationFn: async (pause_hours: number) => (await api.put('/admin/platform-settings/admin-2fa', { pause_hours })).data,
    onSuccess: (saved) => {
      queryClient.setQueryData(['admin-platform-settings'], saved);
      // The reminder banner, and — once it is back on — the sign-in again of a session opened without the code.
      void fetchProfile();
    },
  });
  const error = (mutation.error as any)?.response?.data?.message;

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-4">
        <div className={cn('flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl', pausedUntil ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success')}>
          <KeyRound className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-foreground">Double authentification des administrateurs</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Le code de l'application d'authentification, demandé à la connexion et avant les actions sensibles. Vous pouvez la suspendre
            pour un temps (pendant le développement) ; elle revient toute seule à la fin, ou dès que vous la réactivez.
          </p>
        </div>
        {isLoading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      </div>

      <div className={cn('rounded-xl px-4 py-2.5 text-sm font-medium', pausedUntil ? 'bg-warning/10 text-foreground' : 'bg-success/10 text-success')}>
        {pausedUntil ? <>Suspendue jusqu'au {formatDate(pausedUntil)} : le mot de passe suffit.</> : 'Active : le code est demandé.'}
      </div>

      {pausedUntil ? (
        <Button className="w-full sm:w-auto" disabled={mutation.isPending} onClick={() => setConfirm(0)}>
          {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Réactiver maintenant
        </Button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">Suspendre pendant</p>
          <div className="flex flex-wrap gap-2">
            {DURATIONS.map((d) => (
              <button
                key={d.hours}
                type="button"
                onClick={() => setHours(d.hours)}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-sm font-medium',
                  hours === d.hours ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent',
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
          <Button variant="destructive" className="w-full sm:w-auto" disabled={isLoading || mutation.isPending} onClick={() => setConfirm(hours)}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Suspendre
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Restent actifs pendant la suspension : le mot de passe, les réseaux autorisés et l'historique. Chaque suspension ou réactivation
        est signalée à tous les super admins. À réactiver avant l'ouverture au public.
      </p>
      {error && <p className="text-sm text-destructive">{Array.isArray(error) ? error.join(' ') : error}</p>}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm ? 'Suspendre la double authentification ?' : 'Réactiver la double authentification ?'}
        description={
          confirm
            ? `Pendant ${DURATIONS.find((d) => d.hours === confirm)?.label}, le mot de passe suffira pour entrer dans l'administration et faire les actions sensibles. Tous les super admins seront prévenus.`
            : "Le code sera de nouveau demandé. Les administrateurs connectés sans code (vous compris) devront se reconnecter avec le code de leur application."
        }
        confirmLabel={confirm ? 'Suspendre' : 'Réactiver'}
        variant={confirm ? 'destructive' : 'default'}
        onConfirm={() => {
          if (confirm !== null) mutation.mutate(confirm);
          setConfirm(null);
        }}
      />
    </div>
  );
}
