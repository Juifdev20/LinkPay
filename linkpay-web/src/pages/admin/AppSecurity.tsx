import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Smartphone, Globe, Loader2, Monitor } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatDate } from '@/lib/utils';
import { applyScreenProtection } from '@/lib/screen-protection';

/**
 * Platform-wide security switches — super admin only. Screenshot protection
 * makes screenshots and screen recordings come out black in the Android app
 * for every account (FLAG_SECURE, what WhatsApp does). Phones pick the
 * change up the next time the app comes to the foreground.
 */
export default function AppSecurityPage() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<boolean | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-platform-settings'],
    queryFn: async () => (await api.get('/admin/platform-settings')).data,
  });

  const mutation = useMutation({
    mutationFn: async (enabled: boolean) =>
      (await api.put('/admin/platform-settings', { screenshot_protection: enabled })).data,
    onSuccess: (saved) => {
      queryClient.setQueryData(['admin-platform-settings'], saved);
      // This phone applies it at once; the others on their next foreground.
      applyScreenProtection(!!saved.screenshot_protection);
    },
  });

  const enabled = !!data?.screenshot_protection;

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <PageHeader title="Sécurité de l'application" />

      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-start gap-4">
          <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${enabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground">Bloquer les captures d'écran</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              Les captures et enregistrements d'écran deviennent noirs dans toute l'application, pour tous les comptes — comme WhatsApp.
            </p>
          </div>
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          ) : (
            <Switch
              checked={enabled}
              disabled={mutation.isPending}
              onCheckedChange={(v) => setPending(v)}
              aria-label="Bloquer les captures d'écran"
            />
          )}
        </div>

        <div className={`rounded-xl px-4 py-2.5 text-sm font-medium ${enabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
          {enabled ? 'Protection active' : 'Protection désactivée'}
          {data?.updated_at && (
            <span className="font-normal"> · modifiée le {formatDate(data.updated_at)}</span>
          )}
        </div>

        <div className="space-y-2 text-sm">
          <p className="flex items-start gap-2 text-foreground">
            <Smartphone className="w-4 h-4 mt-0.5 flex-shrink-0 text-success" />
            <span><b>Application Android</b> : protégée. Les téléphones appliquent le changement dès que l'application revient au premier plan.</span>
          </p>
          <p className="flex items-start gap-2 text-foreground">
            <Monitor className="w-4 h-4 mt-0.5 flex-shrink-0 text-success" />
            <span><b>Application Windows</b> : protégée — la fenêtre apparaît noire dans les captures et enregistrements d'écran.</span>
          </p>
          <p className="flex items-start gap-2 text-muted-foreground">
            <Globe className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span><b>Version navigateur</b> : impossible à protéger — aucun navigateur ne permet de bloquer les captures d'écran.</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Aucune protection logicielle n'empêche de photographier l'écran avec un autre appareil.
          </p>
        </div>

        {mutation.isError && (
          <p className="text-sm text-destructive">
            {(mutation.error as any)?.response?.data?.message || 'Échec de la modification — réessayez.'}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending ? 'Activer la protection ?' : 'Désactiver la protection ?'}
        description={
          pending
            ? "Plus personne ne pourra faire de capture ni d'enregistrement d'écran dans l'application Android."
            : "Les captures d'écran seront de nouveau possibles dans l'application, pour tous les comptes."
        }
        confirmLabel={pending ? 'Activer' : 'Désactiver'}
        variant={pending ? 'default' : 'destructive'}
        onConfirm={() => {
          if (pending !== null) mutation.mutate(pending);
          setPending(null);
        }}
      />
    </div>
  );
}
