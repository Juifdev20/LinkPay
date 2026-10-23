import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthField } from '@/components/auth/AuthField';
import { ResultView } from '@/components/ResultView';
import { Loader2, Lock, Link2Off } from 'lucide-react';

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

  const shell = { headline: 'Bienvenue sur', switchPrompt: 'Vous vous en souvenez ?', switchLabel: 'Se connecter', switchTo: '/login' };

  if (!token) {
    return (
      <AuthShell {...shell}>
        <ResultView tone="error" icon={Link2Off} title="Lien expiré" message="Ce lien est incomplet ou n'est plus valable. Demandez-en un nouveau, il arrive en quelques secondes.">
          <Button asChild className="h-[52px] w-full rounded-xl text-base font-semibold"><Link to="/forgot-password">Demander un nouveau lien</Link></Button>
        </ResultView>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell {...shell}>
        <ResultView tone="success" title="Mot de passe changé" message="Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.">
          <Button className="h-[52px] w-full rounded-xl text-base font-semibold" onClick={() => navigate('/login')}>Se connecter</Button>
        </ResultView>
      </AuthShell>
    );
  }

  return (
    <AuthShell {...shell} title="Nouveau mot de passe" subtitle="Choisissez un mot de passe d'au moins 8 caractères, que vous n'utilisez nulle part ailleurs.">
      <form onSubmit={submit}>
        {error && <p role="alert" className="mb-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}
        <AuthField id="password" label="Nouveau mot de passe" icon={Lock} password autoComplete="new-password" placeholder="8 caractères minimum" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        <AuthField id="confirm" label="Confirmer le mot de passe" icon={Lock} password autoComplete="new-password" placeholder="Retapez le mot de passe" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required />
        <Button type="submit" className="mt-3 h-[52px] w-full rounded-xl text-base font-semibold" disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null} Enregistrer
        </Button>
      </form>
    </AuthShell>
  );
}
