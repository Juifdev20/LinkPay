import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import { PinInput } from '@/components/PinInput';
import { Button } from '@/components/ui/button';
import { Lock, Loader2 } from 'lucide-react';

function errorMessage(err: any, fallback: string) {
  const msg = err?.response?.data?.message;
  return Array.isArray(msg) ? msg.join(', ') : msg || fallback;
}

/**
 * Till lock screen for enterprise staff (caissier). The PIN identifies which
 * employee is operating a shared physical register — deliberately NOT the
 * personal wallet transaction PIN (see CashierPinService backend-side).
 * First use creates the PIN (entered twice); after that the same screen
 * verifies it. Unlocks on mount state only — navigating away or reloading
 * re-locks the till, which is the point.
 */
export function CashierPinGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['pos-pin-status'],
    queryFn: async () => (await api.get('/staff/me/pos-pin/status')).data,
  });
  const hasPin = !!data?.has_pin;

  const verifyMutation = useMutation({
    mutationFn: async (value: string) => (await api.post('/staff/me/pos-pin/verify', { pin: value })).data,
    onSuccess: () => {
      setUnlocked(true);
      setPin('');
    },
    onError: (err: any) => {
      setError(errorMessage(err, 'Code PIN incorrect'));
      setPin('');
    },
  });

  const setPinMutation = useMutation({
    mutationFn: async (value: string) => (await api.post('/staff/me/pos-pin', { pin: value })).data,
    onSuccess: () => {
      setUnlocked(true);
      setPin('');
      setConfirmPin('');
    },
    onError: (err: any) => setError(errorMessage(err, "Impossible d'enregistrer le code PIN")),
  });

  // Auto-submit the moment the 4th digit lands — a till keypad shouldn't
  // need a separate "Valider" tap.
  useEffect(() => {
    if (pin.length === 4 && hasPin && !verifyMutation.isPending) {
      verifyMutation.mutate(pin);
    }
  }, [pin]);

  useEffect(() => {
    if (pin) setError('');
  }, [pin, confirmPin]);

  if (unlocked) return <>{children}</>;

  const canConfirmSetup = pin.length === 4 && confirmPin.length === 4;

  const submitSetup = () => {
    if (pin !== confirmPin) {
      setError('Les deux codes ne correspondent pas.');
      setConfirmPin('');
      return;
    }
    setPinMutation.mutate(pin);
  };

  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[70vh] max-w-sm mx-auto text-center">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
        <Lock className="w-8 h-8 text-primary" />
      </div>
      <h1 className="text-xl font-bold text-foreground mb-1">Caisse verrouillée</h1>

      {isLoading ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mt-4" />
      ) : hasPin ? (
        <>
          <p className="text-sm text-muted-foreground mb-6">Entrez votre code de caisse pour déverrouiller.</p>
          <PinInput value={pin} onChange={setPin} autoFocus error={!!error} title="Code de caisse" message={error || undefined} />
          {verifyMutation.isPending && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mt-4" />}
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground mb-6">Première utilisation : définissez votre code de caisse (4 chiffres). Il servira à déverrouiller la caisse partagée.</p>
          <p className="text-xs font-semibold text-muted-foreground mb-2 self-start">Nouveau code</p>
          <PinInput value={pin} onChange={setPin} autoFocus error={!!error} title="Nouveau code de caisse" hint="4 chiffres" />
          <p className="text-xs font-semibold text-muted-foreground mb-2 mt-5 self-start">Confirmer le code</p>
          <PinInput value={confirmPin} onChange={setConfirmPin} error={!!error} title="Confirmer le code de caisse" />
          <Button
            className="w-full mt-6"
            disabled={!canConfirmSetup || setPinMutation.isPending}
            onClick={submitSetup}
          >
            {setPinMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
            Définir le code
          </Button>
        </>
      )}

      {error && <p className="text-sm text-destructive mt-4">{error}</p>}
    </div>
  );
}
