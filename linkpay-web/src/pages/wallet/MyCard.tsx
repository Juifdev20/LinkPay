import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Loader2, RefreshCcw, ShieldAlert, Snowflake, Play, CreditCard, Wallet } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { cn, formatCurrency } from '@/lib/utils';
import { cardFaceData, groupDigits, STATUS_LABEL, type MyCardResponse } from '@/lib/cards';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
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
    <div className="mx-auto max-w-lg space-y-4 px-4 py-5 pb-28 md:p-6 lg:max-w-6xl">
      <PageHeader title="Ma carte" />

      {/* Computer: the card on the left, what it draws on and its settings on the right. */}
      <div className="space-y-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-8 lg:space-y-0">
      <div className="space-y-4 lg:sticky lg:top-24">
      <div>
        <ScaledCard flipped={flipped} front={<CardFront data={face} />} back={<CardBack data={face} />} />
        <div className="mt-3 flex items-center justify-between gap-2">
          {status ? (
            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', status === 'active' ? 'bg-success/10 text-success' : status === 'blocked' || status === 'expired' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning')}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" /> {STATUS_LABEL[status]}
            </span>
          ) : <span />}
          <div className="flex gap-1.5">
            {shown && (
              <button type="button" onClick={() => setRevealed((v) => !v)} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent" aria-label={revealed ? 'Masquer le numéro' : 'Afficher le numéro'}>
                {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {revealed ? 'Masquer' : 'Afficher'}
              </button>
            )}
            <button type="button" onClick={() => setFlipped((v) => !v)} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent">
              <RefreshCcw className="h-3.5 w-3.5" /> {flipped ? 'Recto' : 'Verso'}
            </button>
          </div>
        </div>
      </div>
      </div>
      <div className="space-y-4">
      {/* The card holds no money: this is the wallet it draws on. */}
      <section className="rounded-3xl border border-border bg-card p-4 shadow-soft">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"><Wallet className="h-4 w-4 text-primary" /> Solde utilisé par la carte</p>
        <div className="grid grid-cols-2 gap-2.5">
          {(['CDF', 'USD'] as const).map((c) => (
            <div key={c} className="rounded-2xl bg-muted/60 px-3.5 py-3">
              <p className="text-xs text-muted-foreground">{c === 'CDF' ? 'Francs congolais' : 'Dollars américains'}</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">{formatCurrency(data.balances[c], c)}</p>
            </div>
          ))}
        </div>
      </section>

      {error && <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}

      {!card && (
        <div className="space-y-3 rounded-3xl border border-border bg-card p-6 text-center shadow-soft">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-brand"><CreditCard className="h-7 w-7" /></span>
          <p className="text-lg font-bold">Obtenez votre carte ScanLinkPay</p>
          <p className="text-sm text-muted-foreground">Payez partout où ScanLinkPay est accepté : le commerçant scanne votre carte, vous confirmez avec votre PIN.</p>
          <Button className="h-[52px] w-full rounded-xl text-base font-semibold" disabled={busy} onClick={() => run(() => api.post('/cards/me/request'))}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Demander ma carte
          </Button>
        </div>
      )}

      {status === 'requested' && (
        <div className="rounded-3xl border border-border bg-card p-5 text-sm shadow-soft">
          <p className="mb-1 font-semibold">Demande envoyée</p>
          <p className="text-muted-foreground">Votre carte est en préparation. Vous serez prévenu dès qu'elle est prête à être retirée.</p>
        </div>
      )}

      {status === 'issued' && (
        <form
          className="space-y-3 rounded-3xl border border-border bg-card p-5 shadow-soft"
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
            <PinInput value={pin} onChange={setPin} length={4} title="Entrez votre code PIN" hint="Pour activer votre carte" />
          </div>
          <Button type="submit" className="w-full" disabled={busy || number.replace(/\D/g, '').length !== 16 || pin.length < 4}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Activer la carte
          </Button>
        </form>
      )}

      {status === 'active' && (
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" disabled={busy} onClick={() => run(() => api.post('/cards/me/freeze'))} className="flex flex-col items-start gap-2.5 rounded-3xl border border-border bg-card p-4 text-left shadow-soft transition-colors hover:bg-accent/60 disabled:opacity-60">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 text-sky-500"><Snowflake className="h-5 w-5" /></span>
            <span><span className="block text-sm font-semibold text-foreground">Mettre en pause</span><span className="block text-xs text-muted-foreground">Bloque les paiements, réversible</span></span>
          </button>
          <button type="button" onClick={() => { setPin(''); setError(''); setPinAction('lost'); }} className="flex flex-col items-start gap-2.5 rounded-3xl border border-border bg-card p-4 text-left shadow-soft transition-colors hover:bg-destructive/5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/10 text-destructive"><ShieldAlert className="h-5 w-5" /></span>
            <span><span className="block text-sm font-semibold text-foreground">Déclarer perdue</span><span className="block text-xs text-muted-foreground">Bloque la carte pour toujours</span></span>
          </button>
        </div>
      )}

      {status === 'frozen' && (
        <div className="space-y-3 rounded-3xl border border-border bg-card p-5 shadow-soft">
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Snowflake className="h-4 w-4 text-sky-500" /> Votre carte est en pause : aucun paiement n'est possible.</p>
          <div className="grid grid-cols-2 gap-3">
            <Button onClick={() => { setPin(''); setError(''); setPinAction('unfreeze'); }}><Play className="w-4 h-4 mr-2" /> Réactiver</Button>
            <Button variant="outline" className="text-destructive" onClick={() => { setPin(''); setError(''); setPinAction('lost'); }}>Déclarer perdue</Button>
          </div>
        </div>
      )}

      {status === 'blocked' && (
        <div className="space-y-3 rounded-3xl border border-destructive/30 bg-destructive/5 p-5">
          <p className="font-semibold text-destructive">Cette carte est bloquée</p>
          <p className="text-sm text-muted-foreground">{card?.blocked_reason === 'lost' ? 'Vous l\'avez déclarée perdue.' : 'Elle a été bloquée par ScanLinkPay.'} Elle ne peut plus être utilisée.</p>
          {data.can_request && (
            <Button className="w-full" disabled={busy} onClick={() => run(() => api.post('/cards/me/request'))}>Demander une nouvelle carte</Button>
          )}
        </div>
      )}

      {status === 'expired' && (
        <div className="rounded-3xl border border-border bg-card p-5 text-sm text-muted-foreground shadow-soft">
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
      </div>
    </div>
  );
}
