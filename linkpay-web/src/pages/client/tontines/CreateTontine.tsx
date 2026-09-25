import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { CurrencySelector } from '@/components/CurrencySelector';
import { FormSheet } from '@/components/FormSheet';
import { Loader2, Users } from 'lucide-react';

export default function CreateTontinePage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<'CDF' | 'USD'>('CDF');
  const [frequency, setFrequency] = useState<'weekly' | 'monthly' | 'custom'>('monthly');
  const [customIntervalDays, setCustomIntervalDays] = useState('3');
  const [maxMembers, setMaxMembers] = useState('5');
  const [error, setError] = useState('');

  const createMutation = useMutation({
    mutationFn: async () => {
      const amountCents = Math.round(parseFloat(amount) * 100);
      if (!amountCents || amountCents < 1) {
        throw new Error(`Montant invalide`);
      }
      const members = parseInt(maxMembers, 10);
      if (!members || members < 3 || members > 30) {
        throw new Error('Le nombre de membres doit être entre 3 et 30');
      }
      const intervalDays = parseInt(customIntervalDays, 10);
      if (frequency === 'custom' && (!intervalDays || intervalDays < 1 || intervalDays > 90)) {
        throw new Error('Le nombre de jours doit être entre 1 et 90');
      }
      const { data } = await api.post('/tontines', {
        name,
        contribution_amount_cents: amountCents,
        currency,
        frequency,
        ...(frequency === 'custom' ? { custom_interval_days: intervalDays } : {}),
        max_members: members,
      });
      return data;
    },
    onSuccess: (data) => navigate(`/dashboard/tontines/${data.group.id}`),
    onError: (err: any) => setError(err.response?.data?.message || err.message || 'Erreur lors de la création'),
  });

  return (
    <FormSheet onClose={() => navigate(-1)} title="Nouvelle tontine">
      <div className="p-6 max-w-lg mx-auto">
        <Card>
          <CardContent className="pt-6">
            <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Users className="w-7 h-7 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-1 text-center">Créer une tontine</h2>
            <p className="text-sm text-muted-foreground mb-6 text-center">Épargnez en groupe, à tour de rôle</p>
            {error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium mb-4">
                {error}
              </div>
            )}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="tontine_name" className="font-semibold">Nom de la tontine</Label>
                <Input id="tontine_name" placeholder="Tontine des amies" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label className="font-semibold">Devise</Label>
                <CurrencySelector value={currency} onChange={setCurrency} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tontine_amount" className="font-semibold">Montant de la cotisation ({currency})</Label>
                <Input id="tontine_amount" type="number" step="0.01" placeholder="10000" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label className="font-semibold">Fréquence</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(['weekly', 'monthly'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFrequency(f)}
                      className={`rounded-xl border-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                        frequency === f ? 'border-primary bg-primary/5 text-primary' : 'border-input text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      {f === 'weekly' ? 'Hebdomadaire' : 'Mensuelle'}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setFrequency('custom')}
                  className={`w-full rounded-xl border-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                    frequency === 'custom' ? 'border-primary bg-primary/5 text-primary' : 'border-input text-muted-foreground hover:bg-accent'
                  }`}
                >
                  Journalière (personnalisée)
                </button>
                {frequency === 'custom' && (
                  <div className="space-y-2 pt-2">
                    <Label htmlFor="custom_interval" className="font-semibold text-sm">Tous les combien de jours ?</Label>
                    <Input
                      id="custom_interval"
                      type="number"
                      min={1}
                      max={90}
                      value={customIntervalDays}
                      onChange={(e) => setCustomIntervalDays(e.target.value)}
                      className="max-w-[120px]"
                    />
                    <p className="text-xs text-muted-foreground">Ex: 3 pour une cotisation tous les 3 jours.</p>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="tontine_members" className="font-semibold">Nombre de membres (3 à 30)</Label>
                <Input id="tontine_members" type="number" min={3} max={30} value={maxMembers} onChange={(e) => setMaxMembers(e.target.value)} />
              </div>
              <Button
                className="w-full"
                size="lg"
                disabled={!name || !amount || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                Créer la tontine
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </FormSheet>
  );
}
