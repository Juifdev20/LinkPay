import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, LogIn, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { PublicShell, PublicCard } from '@/components/public/PublicShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const REASONS = [
  { value: 'not_used', label: "Je n'utilise plus ScanLinkPay" },
  { value: 'technical', label: "L'application ne marche pas bien chez moi" },
  { value: 'fees', label: 'Les frais sont trop élevés' },
  { value: 'privacy', label: "Je m'inquiète pour mes données ou ma sécurité" },
  { value: 'other_account', label: "J'ai un autre compte" },
  { value: 'other', label: 'Autre raison' },
] as const;

type Check = { role: string; blockers: { code: string; message: string }[] };

/**
 * « Supprimer mon compte », public page (the address given to Google Play; the app's Paramètres opens it). Signed out:
 * what happens and a sign-in button. Signed in: what must be done first (balance, savings, team…), else why the
 * person leaves, their password, and the deletion. Who may: a client, a merchant, the owner of an enterprise — an
 * employee is told that only their patron can remove them.
 */
export default function DeleteAccountPage() {
  const navigate = useNavigate();
  const { isAuthenticated, user, logout } = useAuthStore();
  const [reason, setReason] = useState<string>('');
  const [comment, setComment] = useState('');
  const [password, setPassword] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [done, setDone] = useState(false);

  const { data: check, isLoading, refetch } = useQuery({
    queryKey: ['account-deletion-check'],
    queryFn: async () => (await api.get('/users/me/deletion')).data as Check,
    enabled: isAuthenticated && !done,
  });

  const remove = useMutation({
    mutationFn: async () => (await api.post('/users/me/delete', { reason, comment: comment || undefined, password })).data,
    onSuccess: async () => {
      setDone(true);
      await logout().catch(() => undefined);
    },
    onError: () => { setPassword(''); void refetch(); },
  });
  const error = (remove.error as any)?.response?.data?.message;

  return (
    <PublicShell onBack={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))} className="md:max-w-xl">
      <PublicCard className="space-y-5 text-sm leading-relaxed text-foreground">
        <header className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"><Trash2 className="h-5 w-5" /></span>
          <div>
            <h1 className="text-xl font-bold">Supprimer mon compte</h1>
            <p className="text-muted-foreground">ScanLinkPay</p>
          </div>
        </header>

        {done ? (
          <div className="space-y-3 py-4 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
            <p className="text-lg font-semibold">Votre compte est supprimé</p>
            <p className="text-muted-foreground">Merci d'avoir utilisé ScanLinkPay. Vous pouvez désinstaller l'application.</p>
          </div>
        ) : (
          <>
            <WhatHappens />

            {!isAuthenticated ? (
              <div className="space-y-3 rounded-2xl bg-muted/60 p-4">
                <p>Connectez-vous avec le compte à supprimer pour continuer.</p>
                <Button className="w-full" onClick={() => navigate('/login?redirect=/supprimer-mon-compte')}>
                  <LogIn className="mr-2 h-4 w-4" /> Me connecter
                </Button>
              </div>
            ) : isLoading || !check ? (
              <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : check.blockers.length ? (
              <div className="space-y-3">
                <p className="font-semibold">Avant de supprimer le compte {user?.full_name ? `de ${user.full_name}` : ''} :</p>
                <ul className="space-y-2">
                  {check.blockers.map((b) => (
                    <li key={b.code} className="flex items-start gap-2 rounded-xl bg-warning/10 px-3.5 py-2.5">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" /> {b.message}
                    </li>
                  ))}
                </ul>
                {!['EMPLOYEE', 'ADMIN'].includes(check.blockers[0].code) && (
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline"><Link to="/dashboard">Ouvrir mon compte</Link></Button>
                    <Button variant="ghost" onClick={() => refetch()}>C'est fait, vérifier à nouveau</Button>
                  </div>
                )}
              </div>
            ) : (
              <form
                className="space-y-5"
                onSubmit={(e) => { e.preventDefault(); remove.mutate(); }}
              >
                <fieldset className="space-y-2">
                  <legend className="mb-1 font-semibold">Pourquoi partez-vous ?</legend>
                  {REASONS.map((r) => (
                    <label
                      key={r.value}
                      className={cn('flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5', reason === r.value ? 'border-primary bg-primary/5' : 'border-border hover:bg-accent')}
                    >
                      <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} className="accent-[hsl(var(--primary))]" />
                      {r.label}
                    </label>
                  ))}
                </fieldset>
                <div className="space-y-1.5">
                  <Label htmlFor="comment">Dites-nous en plus (facultatif)</Label>
                  <textarea
                    id="comment"
                    rows={3}
                    maxLength={1000}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Qu'est-ce qui vous pousse à partir ? Qu'aurions-nous pu mieux faire ?"
                    className="w-full rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Votre mot de passe</Label>
                  <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <label className="flex items-start gap-2.5">
                  <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-1 accent-[hsl(var(--destructive))]" />
                  <span>Je comprends que la suppression est définitive : mon compte ne pourra pas être récupéré.</span>
                </label>
                {error && <p className="rounded-xl bg-destructive/10 px-3.5 py-2.5 text-destructive" role="alert">{Array.isArray(error) ? error.join(' ') : error}</p>}
                <Button type="submit" variant="destructive" className="w-full" disabled={!reason || !password || !understood || remove.isPending}>
                  {remove.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                  Supprimer définitivement mon compte
                </Button>
              </form>
            )}
          </>
        )}

        <p className="border-t border-border pt-4 text-xs text-muted-foreground">
          Voir aussi notre <Link to="/confidentialite" className="font-medium text-primary underline underline-offset-2">politique de confidentialité</Link>.
        </p>
      </PublicCard>
    </PublicShell>
  );
}

function WhatHappens() {
  return (
    <div className="space-y-3">
      <div>
        <p className="font-semibold">Qui peut supprimer son compte ?</p>
        <p className="text-muted-foreground">
          Un client, un marchand (sa boutique ferme avec le compte) et le patron d'une entreprise (l'entreprise ferme avec le compte).
          Un employé (vendeur/caissier, gérant, magasinier…) ne peut pas : seul son patron peut le retirer de l'équipe.
        </p>
      </div>
      <div>
        <p className="font-semibold">Avant</p>
        <p className="text-muted-foreground">Votre solde, votre épargne et vos retraits en cours doivent être à zéro, et votre équipe retirée. Nous ne prenons jamais votre argent.</p>
      </div>
      <div>
        <p className="font-semibold">Ce qui est effacé</p>
        <p className="text-muted-foreground">Votre nom, votre téléphone, votre email, votre photo, vos codes (PIN, code d'accès, code de secours) et vos appareils. La connexion est bloquée aussitôt.</p>
      </div>
      <div>
        <p className="font-semibold">Ce qui est gardé</p>
        <p className="text-muted-foreground">Les opérations financières (envois, paiements, retraits, ventes), sans votre nom, pendant la durée exigée par la loi.</p>
      </div>
    </div>
  );
}
