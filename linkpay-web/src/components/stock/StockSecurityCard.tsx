import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { StockPasswordDialog } from './StockPasswordDialog';
import { Loader2 } from 'lucide-react';

/**
 * The owner's switch for the stock management password — off by default.
 * Off: only the owner and the stock keeper change the stock (role check), and
 * every change is written in the journal. On: the shared password is asked
 * for every change. Switching it on the first time has the owner choose the
 * password first; the API asks for their access code to confirm (api.ts).
 */
export function StockSecurityCard({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const [defining, setDefining] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const { data: status, isLoading } = useQuery({
    queryKey: ['stock-password-status', orgId],
    queryFn: async () => (await api.get(`/organizations/${orgId}/stock-password/status`)).data as { is_set: boolean; required: boolean },
  });

  const save = async (required: boolean) => {
    setSaving(true);
    setError('');
    try {
      await api.put(`/organizations/${orgId}/stock-password/required`, { required });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['stock-password-status', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['my-organization'] }),
      ]);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Modification impossible, réessayez.');
    } finally {
      setSaving(false);
    }
  };

  const onToggle = (required: boolean) => {
    // The first time, the password has to be chosen before it can be required.
    if (required && !status?.is_set) setDefining(true);
    else save(required);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sécurité du stock</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Exiger le mot de passe pour modifier le stock</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {status?.required
                ? 'Activé : le mot de passe est demandé pour ajouter, modifier ou supprimer un article, enregistrer un mouvement, valider un inventaire ou archiver une vente.'
                : 'Désactivé : seuls vous, le gérant et le magasinier pouvez modifier le stock, sans mot de passe. Tout est noté dans le Journal.'}
            </p>
          </div>
          {isLoading || saving ? (
            <Loader2 className="mt-1 h-5 w-5 flex-shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Switch
              aria-label="Exiger le mot de passe du stock"
              checked={!!status?.required}
              onCheckedChange={onToggle}
            />
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>

      {defining && (
        <StockPasswordDialog
          orgId={orgId}
          open
          onClose={() => setDefining(false)}
          onUnlocked={() => {
            setDefining(false);
            save(true);
          }}
        />
      )}
    </Card>
  );
}
