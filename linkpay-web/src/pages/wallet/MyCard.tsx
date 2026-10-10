import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Loader2, RefreshCcw, ShieldAlert, Snowflake, Play, CreditCard } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { formatCurrency } from '@/lib/utils';
import { cardFaceData, groupDigits, STATUS_LABEL, type MyCardResponse } from '@/lib/cards';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PinInput } from '@/components/PinInput';
import { CardBack, CardFront, ScaledCard } from '@/components/card/ScanLinkPayCard';

type PinAction = 'unfreeze' | 'lost' | null;

const errorOf = (err: any) => err?.response?.data?.message || 'Une erreur est survenue. Réessayez.';

/** "Ma carte": the card as it looks in the hand, the balances of the wallet, and what the holder can do with it. */
export default function MyCardPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [flipped, setFlipped] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [number, setNumber] = useState('');
  const [pin, setPin] = useState('');
  const [pinAction, setPinAction] = useState<PinAction>(null);

  const { data, isLoading } = useQuery<MyCardResponse>({
    queryKey: ['my-card'],
    queryFn: async () => (await api.get('/cards/me')).data,
  });

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setError('');
    setBusy(true);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ['my-card'] });
      after?.();
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  if (isLoading || !data) {
    return (
      <div className="p-4 max-w-lg mx-auto">
        <PageHeader title="Ma carte" />
        <div className="py-16"><Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" /></div>
      </div>
    );
  }

  const card = data.card;
  const status = card?.status;
  const face = cardFaceData(data, user?.full_name || '', revealed);
  const shown = status === 'active' || status === 'frozen' || status === 'issued';

  const confirmPin = () =>
    run(
      () => (pinAction === 'lost' ? api.post('/cards/me/report-lost', { pin }) : api.post('/cards/me/unfreeze', { pin })),
      () => { setPin(''); setPinAction(null); },
    );

  return (
    <div className="p-4 max-w-lg mx-auto space-y-5 pb-28">
      <PageHeader title="Ma carte" />

      <div>
        <ScaledCard flipped={flipped} front={<CardFront data={face} />} back={<CardBack data={face} />} />
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-2">
            {status && <Badge variant={status === 'active' ? 'success' : status === 'blocked' || status === 'expired' ? 'error' : 'warning'}>{STATUS_LABEL[status]}</Badge>}
          </div>
          <div className="flex gap-1">
            {shown && (
              <Button variant="ghost" size="sm" onClick={() => setRevealed((v) => !v)} aria-label={revealed ? 'Masquer le numéro' : 'Afficher le numéro'}>
                {revealed ? <EyeOff className="w-4 h-4 mr-1" /> : <Eye className="w-4 h-4 mr-1" />}
                {revealed ? 'Masquer' : 'Afficher'}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setFlipped((v) => !v)}>
              <RefreshCcw className="w-4 h-4 mr-1" /> {flipped ? 'Recto' : 'Verso'}
            </Button>
          </div>
        </div>
      </div>

      {/* The card holds no money: this is the wallet it draws on. */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Solde de votre portefeuille</p>
        <div className="grid grid-cols-2 gap-3">
          <div><p className="text-xs text-muted-foreground">Francs congolais</p><p className="text-lg font-bold">{formatCurrency(data.balances.CDF, 'CDF')}</p></div>
          <div><p className="text-xs text-muted-foreground">Dollars</p><p className="text-lg font-bold">{formatCurrency(data.balances.USD, 'USD')}</p></div>
        </div>
      </div>

      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      {!card && (
        <div className="rounded-2xl border border-border bg-card p-5 text-center space-y-3">
          <CreditCard className="w-8 h-8 text-primary mx-auto" />
          <p className="font-semibold">Vous n'avez pas encore de carte ScanLinkPay</p>
          <p className="text-sm text-muted-foreground">Elle sert à payer vos factures, partout où ScanLinkPay est accepté, avec votre PIN.</p>
          <Button className="w-full" disabled={busy} onClick={() => run(() => api.post('/cards/me/request'))}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Demander ma carte
          </Button>
        </div>
      )}

      {status === 'requested' && (
        <div className="rounded-2xl border border-border bg-card p-5 text-sm">
          <p className="font-semibold mb-1">Demande envoyée</p>
          <p className="text-muted-foreground">Votre carte est en préparation. Vous serez prévenu dès qu'elle est prête à être retirée.</p>
        </div>
      )}

      {status === 'issued' && (
        <form
          className="rounded-2xl border border-border bg-card p-5 space-y-3"
          onSubmit={(e) => { e.preventDefault(); void run(() => api.post('/cards/me/activate', { card_number: number, pin }), () => { setNumber(''); setPin(''); }); }}
        >
          <p className="font-semibold">Activez votre carte</p>
          <p className="text-sm text-muted-foreground">Saisissez les 16 chiffres inscrits sur la carte que vous avez reçue, puis votre PIN. Tant qu'elle n'est pas activée, la carte ne peut rien payer.</p>
          <div>
            <Label htmlFor="card-number">Numéro de la carte</Label>
            <Input id="card-number" inputMode="numeric" autoComplete="off" placeholder="0000 0000 0000 0000" value={number} onChange={(e) => setNumber(groupDigits(e.target.value))} />
          </div>
          <div>
            <Label>Votre PIN</Label>
            <PinInput value={pin} onChange={setPin} length={4} title="Entrer votre code PIN" hint="Pour activer votre carte" />
          </div>
          <Button type="submit" className="w-full" disabled={busy || number.replace(/\D/g, '').length !== 16 || pin.length < 4}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Activer la carte
          </Button>
        </form>
      )}

      {status === 'active' && (
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" disabled={busy} onClick={() => run(() => api.post('/cards/me/freeze'))}>
            <Snowflake className="w-4 h-4 mr-2" /> Mettre en pause
          </Button>
          <Button variant="outline" className="text-destructive" onClick={() => { setPin(''); setError(''); setPinAction('lost'); }}>
            <ShieldAlert className="w-4 h-4 mr-2" /> Déclarer perdue
          </Button>
        </div>
      )}

      {status === 'frozen' && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <p className="text-sm text-muted-foreground">Votre carte est en pause : aucun paiement n'est possible.</p>
          <div className="grid grid-cols-2 gap-3">
            <Button onClick={() => { setPin(''); setError(''); setPinAction('unfreeze'); }}><Play className="w-4 h-4 mr-2" /> Réactiver</Button>
            <Button variant="outline" className="text-destructive" onClick={() => { setPin(''); setError(''); setPinAction('lost'); }}>Déclarer perdue</Button>
          </div>
        </div>
      )}

      {status === 'blocked' && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5 space-y-3">
          <p className="font-semibold text-destructive">Cette carte est bloquée</p>
          <p className="text-sm text-muted-foreground">{card?.blocked_reason === 'lost' ? 'Vous l\'avez déclarée perdue.' : 'Elle a été bloquée par ScanLinkPay.'} Elle ne peut plus être utilisée.</p>
          {data.can_request && (
            <Button className="w-full" disabled={busy} onClick={() => run(() => api.post('/cards/me/request'))}>Demander une nouvelle carte</Button>
          )}
        </div>
      )}

      {status === 'expired' && (
        <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
          Votre carte a expiré. Rendez-vous auprès de ScanLinkPay pour recevoir une nouvelle carte.
        </div>
      )}

      <Dialog open={pinAction !== null} onOpenChange={(o) => { if (!o) { setPinAction(null); setPin(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pinAction === 'lost' ? 'Déclarer la carte perdue ou volée' : 'Réactiver la carte'}</DialogTitle>
            <DialogDescription>
              {pinAction === 'lost'
                ? 'La carte sera bloquée définitivement. Vous pourrez en demander une nouvelle. Confirmez avec votre PIN.'
                : 'Confirmez avec votre PIN.'}
            </DialogDescription>
          </DialogHeader>
          <PinInput value={pin} onChange={setPin} length={4} autoFocus message={error || undefined} hint={pinAction === 'lost' ? 'Déclarer la carte perdue' : undefined} />
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button className="w-full" variant={pinAction === 'lost' ? 'destructive' : 'default'} disabled={busy || pin.length < 4} onClick={confirmPin}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Confirmer
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
