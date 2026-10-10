import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CreditCard, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { useAppLock } from '@/lib/app-lock-store';
import type { MyCardResponse } from '@/lib/cards';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PinInput } from '@/components/PinInput';

interface PendingCharge { id: string; merchant_name: string; amount_cents: number; currency: string; description: string | null; expires_at: string }

/**
 * A merchant scanned this person's card: the request lands here, on their own phone, and nothing is paid until they
 * type their PIN. Only people with an ACTIVE card poll (every 5 s while the app is open).
 */
export function CardChargePrompt() {
  const queryClient = useQueryClient();
  const locked = useAppLock((s) => s.locked);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paid, setPaid] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);

  const { data: mine } = useQuery<MyCardResponse>({
    queryKey: ['my-card'],
    queryFn: async () => (await api.get('/cards/me')).data,
    staleTime: 60_000,
    retry: false,
  });
  const active = mine?.card?.status === 'active';

  const { data: pending = [] } = useQuery<PendingCharge[]>({
    queryKey: ['card-charges-pending'],
    queryFn: async () => (await api.get('/cards/charges/pending')).data,
    enabled: active,
    refetchInterval: 5000,
    retry: false,
  });

  const current = pending.find((c) => !dismissed.includes(c.id));
  useEffect(() => { setPin(''); setError(''); }, [current?.id]);
  useEffect(() => {
    if (!paid) return;
    const t = setTimeout(() => setPaid(false), 2500);
    return () => clearTimeout(t);
  }, [paid]);

  const settle = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['card-charges-pending'] }),
      queryClient.invalidateQueries({ queryKey: ['wallet'] }),
      queryClient.invalidateQueries({ queryKey: ['my-card'] }),
    ]);
  };

  const approve = async () => {
    if (!current) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/cards/charges/${current.id}/approve`, { pin });
      setPaid(true);
      setPin('');
      await settle();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Le paiement a échoué.');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    if (!current) return;
    setBusy(true);
    try {
      await api.post(`/cards/charges/${current.id}/decline`);
    } catch {
      // Already closed (expired, paid elsewhere): the list below refreshes either way.
    }
    setDismissed((d) => [...d, current.id]);
    setBusy(false);
    await settle();
  };

  return (
    <>
      <Dialog open={!!current && !locked} onOpenChange={() => undefined}>
        <DialogContent onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CreditCard className="w-5 h-5 text-primary" /> Paiement par carte</DialogTitle>
            <DialogDescription>
              <span className="font-semibold text-foreground">{current?.merchant_name}</span> demande{' '}
              <span className="font-semibold text-foreground">{current ? formatCurrency(current.amount_cents, current.currency) : ''}</span>.
              {current?.description ? ` ${current.description}.` : ''} Confirmez avec votre PIN, ou refusez si vous ne reconnaissez pas ce paiement.
            </DialogDescription>
          </DialogHeader>
          <PinInput value={pin} onChange={setPin} length={4} autoFocus error={!!error} title="Confirmer le paiement" hint={current ? `${current.merchant_name} demande ${formatCurrency(current.amount_cents, current.currency)}` : undefined} message={error || undefined} />
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" disabled={busy} onClick={decline}>Refuser</Button>
            <Button className="flex-1" disabled={busy || pin.length < 4} onClick={approve}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Payer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={paid} onOpenChange={setPaid}>
        <DialogContent>
          <div className="text-center py-4">
            <CheckCircle2 className="w-12 h-12 text-success mx-auto mb-3" />
            <p className="font-bold">Paiement effectué</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
