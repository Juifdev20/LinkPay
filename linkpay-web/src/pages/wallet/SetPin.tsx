import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PinInput } from '@/components/PinInput';
import { Loader2, ShieldCheck, ArrowLeft, Check } from 'lucide-react';

const PIN_LENGTH = 4;

type Step = 'current' | 'new' | 'confirm' | 'done';

export default function SetPinPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: status } = useQuery({
    queryKey: ['wallet-pin-status'],
    queryFn: async () => {
      const { data } = await api.get('/wallet/pin/status');
      return data as { has_pin: boolean };
    },
  });

  const hasPin = status?.has_pin;
  const [step, setStep] = useState<Step>('new');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Once we know whether a PIN already exists, start on the right step
  // (changing an existing PIN requires confirming it first).
  const startStep: Step = hasPin ? 'current' : 'new';
  const [started, setStarted] = useState(false);
  if (!started && status !== undefined) {
    setStarted(true);
    setStep(startStep);
  }

  const submit = async (finalPin: string) => {
    setSaving(true);
    setError('');
    try {
      await api.post('/wallet/pin', { pin: finalPin, current_pin: hasPin ? currentPin : undefined });
      queryClient.invalidateQueries({ queryKey: ['wallet-pin-status'] });
      setStep('done');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Erreur lors de la configuration du PIN');
      setStep(hasPin ? 'current' : 'new');
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
    } finally {
      setSaving(false);
    }
  };

  const handleCurrentComplete = (val: string) => {
    setCurrentPin(val);
    if (val.length === PIN_LENGTH) setStep('new');
  };

  const handleNewComplete = (val: string) => {
    setNewPin(val);
    if (val.length === PIN_LENGTH) setStep('confirm');
  };

  const handleConfirmComplete = (val: string) => {
    setConfirmPin(val);
    if (val.length === PIN_LENGTH) {
      if (val !== newPin) {
        setError('Les deux codes PIN ne correspondent pas');
        setConfirmPin('');
        return;
      }
      submit(val);
    }
  };

  if (step === 'done') {
    return (
      <div className="p-6 max-w-md mx-auto">
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-success" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-1">Code PIN {hasPin ? 'modifié' : 'configuré'} !</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Il sera demandé pour chaque envoi, paiement ou retrait.
            </p>
            <Button className="w-full" size="lg" onClick={() => navigate(-1)}>
              Retour
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-md mx-auto">
      <Card>
        <CardContent className="pt-6 text-center">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 float-left"
          >
            <ArrowLeft className="w-4 h-4" /> Retour
          </button>
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4 mt-8">
            <ShieldCheck className="w-7 h-7 text-primary" />
          </div>

          {error && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium mb-4">
              {error}
            </div>
          )}

          {step === 'current' && (
            <>
              <h2 className="text-lg font-bold text-foreground mb-1">Code PIN actuel</h2>
              <p className="text-sm text-muted-foreground mb-6">Confirmez votre code PIN actuel pour le modifier</p>
              <PinInput value={currentPin} onChange={handleCurrentComplete} length={PIN_LENGTH} autoFocus />
            </>
          )}

          {step === 'new' && (
            <>
              <h2 className="text-lg font-bold text-foreground mb-1">{hasPin ? 'Nouveau code PIN' : 'Créer votre code PIN'}</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Ce code à {PIN_LENGTH} chiffres protège vos envois, paiements et retraits
              </p>
              <PinInput value={newPin} onChange={handleNewComplete} length={PIN_LENGTH} autoFocus />
            </>
          )}

          {step === 'confirm' && (
            <>
              <h2 className="text-lg font-bold text-foreground mb-1">Confirmez le code PIN</h2>
              <p className="text-sm text-muted-foreground mb-6">Saisissez-le à nouveau pour confirmer</p>
              <PinInput value={confirmPin} onChange={handleConfirmComplete} length={PIN_LENGTH} autoFocus />
            </>
          )}

          {saving && <Loader2 className="w-5 h-5 animate-spin text-primary mx-auto mt-6" />}
        </CardContent>
      </Card>
    </div>
  );
}
