import { CloudOff, CloudUpload, AlertTriangle, RotateCw, Trash2, CheckCircle2, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { formatLastOnline, useNetwork } from '@/lib/network';
import { discardOp, flushOutbox, retryOp, useOutbox, type OutboxOp } from '@/lib/outbox';
import { cn } from '@/lib/utils';

const when = (t: number) => new Date(t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * "Synchronisation": what was done without network and is still on this device. Waiting operations leave by
 * themselves; refused ones stay here with the server's reason until the person retries or gives them up.
 */
export default function SyncPage() {
  const online = useNetwork((s) => s.online);
  const lastOnlineAt = useNetwork((s) => s.lastOnlineAt);
  const ops = useOutbox((s) => s.ops);
  const flushing = useOutbox((s) => s.flushing);
  const failed = ops.filter((o) => o.status === 'error');
  const waiting = ops.filter((o) => o.status !== 'error');

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-5 pb-28 md:p-6">
      <PageHeader title="Synchronisation" />

      <section className="flex items-center gap-4 rounded-3xl border border-border bg-card p-5 shadow-soft">
        <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white', online ? 'bg-success' : 'bg-slate-700')}>
          {online ? <CloudUpload className="h-6 w-6" /> : <CloudOff className="h-6 w-6" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-foreground">{online ? 'En ligne' : 'Hors ligne'}</p>
          <p className="text-sm text-muted-foreground">
            {online
              ? ops.length ? `${waiting.length} en attente · ${failed.length} refusée${failed.length > 1 ? 's' : ''}` : 'Tout est à jour sur le serveur.'
              : `Dernière connexion ${formatLastOnline(lastOnlineAt)}. Tout sera envoyé au retour du réseau.`}
          </p>
        </div>
        {online && waiting.length > 0 && (
          <Button size="sm" className="h-10 shrink-0 rounded-xl" disabled={flushing} onClick={() => void flushOutbox()}>
            {flushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
            <span className="ml-1.5 hidden sm:inline">Envoyer</span>
          </Button>
        )}
      </section>

      {ops.length === 0 && (
        <div className="flex flex-col items-center py-10 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-success/10 text-success"><CheckCircle2 className="h-7 w-7" /></span>
          <p className="mt-3 font-semibold text-foreground">Rien en attente</p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">Ce que vous faites sans réseau (dépenses notées, ventes en espèces…) apparaît ici jusqu'à son envoi.</p>
        </div>
      )}

      {failed.length > 0 && (
        <OpList
          title="Refusées par le serveur"
          hint="Elles ne partiront plus toutes seules : réessayez après avoir corrigé le problème, ou abandonnez-les."
          ops={failed}
        />
      )}
      {waiting.length > 0 && <OpList title="En attente d'envoi" ops={waiting} />}
    </div>
  );
}

function OpList({ title, hint, ops }: { title: string; hint?: string; ops: OutboxOp[] }) {
  return (
    <section className="rounded-3xl border border-border bg-card px-4 py-2 shadow-soft sm:px-5">
      <p className="pt-3 text-sm font-semibold text-foreground">{title} <span className="text-muted-foreground">({ops.length})</span></p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      {ops.map((op) => (
        <div key={op.id} className="flex items-start gap-3 border-b border-border py-3.5 last:border-0">
          <span className={cn('mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl', op.status === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary')}>
            {op.status === 'error' ? <AlertTriangle className="h-5 w-5" /> : op.status === 'sending' ? <Loader2 className="h-5 w-5 animate-spin" /> : <CloudUpload className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{op.label}</p>
            <p className="text-xs text-muted-foreground">{op.detail ? `${op.detail} · ` : ''}{when(op.createdAt)}</p>
            {op.error && <p className="mt-1 text-xs font-medium text-destructive">{op.error}</p>}
            {op.status === 'error' && (
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" className="h-8 rounded-full" onClick={() => retryOp(op.id)}>
                  <RotateCw className="mr-1.5 h-3.5 w-3.5" /> Réessayer
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => { if (window.confirm('Abandonner cette opération ? Elle ne sera jamais envoyée.')) discardOp(op.id); }}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Abandonner
                </Button>
              </div>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
