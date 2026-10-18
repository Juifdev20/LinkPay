import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, CheckCircle2 } from 'lucide-react';

/** The recovery token Supabase puts in the email's link (#access_token=…, or ?access_token=…). */
function tokenFromUrl(): string {
  const read = (raw: string) => new URLSearchParams(raw.replace(/^[#?]/, ''));
  const hash = read(window.location.hash);
  const query = read(window.location.search);
  return hash.get('access_token') || query.get('access_token') || '';
}

/** Opened from the "forgotten password" email: choose the new password. */
export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [token] = useState(tokenFromUrl);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Au moins 8 caractères.');
    if (password !== confirm) return setError('Les deux mots de passe ne correspondent pas.');
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { access_token: token, new_password: password });
      setDone(true);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Ce lien ne fonctionne plus. Demandez-en un nouveau.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl md:p-8">
        <h1 className="mb-1 text-2xl font-bold text-foreground">Nouveau mot de passe</h1>
        {!token ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Ce lien est incomplet ou a expiré. <Link to="/forgot-password" className="font-semibold text-primary">Demander un nouveau lien</Link>.
          </p>
        ) : done ? (
          <div className="mt-4 space-y-4">
            <p className="flex items-center gap-2 rounded-xl bg-success/10 px-4 py-3 text-sm font-medium text-success">
              <CheckCircle2 className="h-4 w-4" /> Votre mot de passe a été changé.
            </p>
            <Button className="w-full" onClick={() => navigate('/login')}>Se connecter</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-4">
            {error && <p className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}
            <div className="space-y-2">
              <Label htmlFor="password" className="font-semibold">Nouveau mot de passe</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm" className="font-semibold">Confirmer</Label>
              <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required />
            </div>
            <Button type="submit" className="w-full py-6 text-base font-semibold" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-5 w-5 animate-spin" />} Enregistrer
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
