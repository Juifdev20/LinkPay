import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, ArrowLeft, Bell, TrendingUp, Zap, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function TontineSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id);

  const { data, isLoading } = useQuery({
    queryKey: ['tontine', id],
    queryFn: async () => (await api.get(`/tontines/${id}`)).data,
    enabled: !!id,
  });

  const [description, setDescription] = useState('');
  const [reminderDays, setReminderDays] = useState('2');
  const [penaltyEnabled, setPenaltyEnabled] = useState(false);
  const [penaltyPercent, setPenaltyPercent] = useState('2');
  const [autoPayEnabled, setAutoPayEnabled] = useState(false);
  const [autoPayDays, setAutoPayDays] = useState<0 | 2 | 4>(2);
  const [error, setError] = useState('');

  // Seed the form from the loaded group exactly once it arrives — avoids
  // fighting the user's in-progress edits on every background refetch.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (data?.group && !seeded) {
      setDescription(data.group.description || '');
      setReminderDays(String(data.group.reminder_days_before ?? 2));
      setPenaltyEnabled(!!data.group.late_penalty_enabled);
      setPenaltyPercent(String(data.group.late_penalty_percent_per_day ?? 2));
      setAutoPayEnabled(!!data.group.auto_payment_enabled);
      setAutoPayDays((data.group.auto_payment_days_before ?? 2) as 0 | 2 | 4);
      setSeeded(true);
    }
  }, [data, seeded]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, any> = {
        description,
        reminder_days_before: parseInt(reminderDays, 10) || 2,
        late_penalty_enabled: penaltyEnabled,
        auto_payment_enabled: autoPayEnabled,
      };
      if (penaltyEnabled) payload.late_penalty_percent_per_day = parseFloat(penaltyPercent) || 0;
      if (autoPayEnabled) payload.auto_payment_days_before = autoPayDays;
      return (await api.put(`/tontines/${id}/settings`, payload)).data;
    },
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['tontine', id] });
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Échec de l\'enregistrement'),
  });

  const optInMutation = useMutation({
    mutationFn: async (enabled: boolean) => (await api.post(`/tontines/${id}/auto-payment-optin`, { enabled })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tontine', id] }),
  });

  if (isLoading || !data) {
    return (
      <div className="p-6 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const { group, members } = data;
  const isCreator = group.creator_id === currentUserId;
  const myMember = members.find((m: any) => m.user_id === currentUserId);

  return (
    <div className="p-6 pb-28 md:pb-6 space-y-6 max-w-2xl mx-auto">
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> Retour
      </button>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Réglages</h1>
        <p className="text-sm text-muted-foreground">{group.name}</p>
      </div>

      {!isCreator && (
        <Card>
          <CardContent className="pt-6 space-y-4 text-sm">
            <div className="flex items-start gap-3">
              <FileText className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <p className="text-foreground">{group.description || 'Aucune description pour cette tontine.'}</p>
            </div>
            <div className="flex items-start gap-3">
              <Bell className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <p className="text-foreground">Un rappel est envoyé {group.reminder_days_before} jour{group.reminder_days_before > 1 ? 's' : ''} avant l'échéance de chacun.</p>
            </div>
            <div className="flex items-start gap-3">
              <TrendingUp className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <p className="text-foreground">
                {group.late_penalty_enabled
                  ? `Un retard entraîne +${group.late_penalty_percent_per_day}% par jour, après le délai de grâce de ${group.grace_period_days} jour${group.grace_period_days > 1 ? 's' : ''}.`
                  : 'Aucune pénalité de retard sur cette tontine.'}
              </p>
            </div>
            <div className="flex items-start gap-3">
              <Zap className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <p className="text-foreground">
                {group.auto_payment_enabled
                  ? `Paiement automatique possible, ${group.auto_payment_days_before === 0 ? "le jour même de l'échéance" : `${group.auto_payment_days_before} jours avant l'échéance`}.`
                  : "Pas de paiement automatique sur cette tontine — chacun cotise soi-même."}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {isCreator && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Réglages du groupe</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="tontine_description" className="font-semibold">Description (visible par tous les membres)</Label>
              <textarea
                id="tontine_description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Tontine des amies du quartier, versement chaque fin de mois."
                rows={3}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reminder_days" className="font-semibold">Rappel avant l'échéance (jours)</Label>
              <Input
                id="reminder_days"
                type="number"
                min={1}
                max={14}
                value={reminderDays}
                onChange={(e) => setReminderDays(e.target.value)}
                className="max-w-[120px]"
              />
              <p className="text-xs text-muted-foreground">Chaque membre reçoit une alerte ce nombre de jours avant sa propre échéance.</p>
            </div>

            <div className="pt-2 border-t border-border space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-sm text-foreground">Pénalité de retard</p>
                  <p className="text-xs text-muted-foreground">Ajoute un pourcentage chaque jour de retard, après le délai de grâce.</p>
                </div>
                <Switch checked={penaltyEnabled} onCheckedChange={setPenaltyEnabled} />
              </div>
              {penaltyEnabled && (
                <div className="space-y-2">
                  <Label htmlFor="penalty_percent" className="font-semibold text-sm">Pourcentage ajouté par jour de retard (%)</Label>
                  <Input
                    id="penalty_percent"
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    value={penaltyPercent}
                    onChange={(e) => setPenaltyPercent(e.target.value)}
                    className="max-w-[120px]"
                  />
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-border space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-sm text-foreground">Paiement automatique</p>
                  <p className="text-xs text-muted-foreground">Chaque membre devra en plus l'activer lui-même pour sa propre cotisation.</p>
                </div>
                <Switch checked={autoPayEnabled} onCheckedChange={setAutoPayEnabled} />
              </div>
              {autoPayEnabled && (
                <div className="space-y-2">
                  <Label className="font-semibold text-sm">Quand déclencher le paiement ?</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {([0, 2, 4] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setAutoPayDays(d)}
                        className={cn(
                          'rounded-xl border-2 px-2 py-2.5 text-xs font-semibold transition-colors',
                          autoPayDays === d ? 'border-primary bg-primary/5 text-primary' : 'border-input text-muted-foreground hover:bg-accent',
                        )}
                      >
                        {d === 0 ? 'Le jour même' : `${d} jours avant`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
              Enregistrer
            </Button>
          </CardContent>
        </Card>
      )}

      {group.auto_payment_enabled && myMember && (
        <Card>
          <CardContent className="pt-6 flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-sm text-foreground">Activer le paiement automatique pour moi</p>
              <p className="text-xs text-muted-foreground">
                Votre solde sera débité automatiquement {group.auto_payment_days_before === 0 ? "le jour de l'échéance" : `${group.auto_payment_days_before} jours avant l'échéance`}, sans avoir à ouvrir l'app — uniquement si vous l'activez ici.
              </p>
            </div>
            <Switch
              checked={!!myMember.auto_payment_opt_in}
              disabled={optInMutation.isPending}
              onCheckedChange={(checked) => optInMutation.mutate(checked)}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
