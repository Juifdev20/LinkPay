import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { setTokens } from '@/lib/token-storage';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, ShieldCheck, Copy, Download } from 'lucide-react';

type Setup = { secret: string; qr_data_url: string };

/**
 * Administrators can't use the back office with a password alone. This page
 * (the only one an unverified admin session can reach) links an authenticator
 * app, shows the recovery codes once, then swaps the session for a verified one.
 */
export default function AdminTwoFactorSetupPage() {
  const navigate = useNavigate();
  const { user, logout, fetchProfile } = useAuthStore();
  const [status, setStatus] = useState<{ enabled: boolean; verified_session: boolean } | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<string[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: st } = await api.get('/auth/2fa/status');
        setStatus(st);
        if (!st.enabled) {
          const { data } = await api.post('/auth/2fa/setup');
          setSetup(data);
        }
      } catch (e: any) {
        setError(e.response?.data?.message || 'Impossible de préparer la configuration');
      }
    })();
  }, []);

  if (!user) return <Navigate to="/login" replace />;
  if (!['admin', 'super_admin'].includes(user.role)) return <Navigate to="/dashboard" replace />;

  const enable = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/auth/2fa/enable', { code: code.trim() });
      setTokens(data.access_token, data.refresh_token);
      setRecovery(data.recovery_codes);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Code incorrect');
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    await fetchProfile();
    navigate('/dashboard', { replace: true });
  };

  const download = () => {
    const blob = new Blob([`Codes de secours ScanLinkPay (${user.email})\nChaque code ne sert qu'une fois.\n\n${recovery!.join('\n')}\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'scanlinkpay-codes-de-secours.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md bg-card rounded-2xl p-6 border border-border shadow-2xl space-y-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-bold text-foreground">Sécurisez votre compte administrateur</h1>
        </div>

        {error && <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">{error}</div>}

        {recovery ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Double authentification activée. Voici vos <strong>codes de secours</strong> : ils permettent de se connecter si vous perdez votre téléphone.
              Chaque code ne marche qu'une fois. <strong>Ils ne seront plus affichés.</strong>
            </p>
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-3 font-mono text-sm text-foreground">
              {recovery.map((c) => <span key={c}>{c}</span>)}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => navigator.clipboard?.writeText(recovery.join('\n'))}><Copy className="w-4 h-4 mr-2" />Copier</Button>
              <Button variant="outline" className="flex-1" onClick={download}><Download className="w-4 h-4 mr-2" />Télécharger</Button>
            </div>
            <Button className="w-full" onClick={finish}>J'ai sauvegardé mes codes — continuer</Button>
          </div>
        ) : status?.enabled ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              La double authentification est déjà activée sur ce compte, mais cette session ne l'a pas utilisée. Reconnectez-vous en saisissant le code de votre application.
            </p>
            <Button className="w-full" onClick={async () => { await logout(); navigate('/login', { replace: true }); }}>Me reconnecter</Button>
          </div>
        ) : setup ? (
          <form onSubmit={enable} className="space-y-4">
            <ol className="text-sm text-muted-foreground list-decimal pl-5 space-y-1">
              <li>Installez <strong>Google Authenticator</strong> (ou Microsoft Authenticator, Authy…) sur votre téléphone.</li>
              <li>Scannez ce QR code.</li>
              <li>Saisissez le code à 6 chiffres affiché.</li>
            </ol>
            <img src={setup.qr_data_url} alt="QR code à scanner" className="mx-auto rounded-xl border border-border bg-white p-2" width={200} height={200} />
            <p className="text-xs text-center text-muted-foreground break-all">Ou saisissez la clé : <span className="font-mono">{setup.secret}</span></p>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="text-center text-xl tracking-widest"
            />
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
              {busy && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}Activer
            </Button>
          </form>
        ) : !error ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : null}

        {!recovery && (
          <button className="text-xs text-muted-foreground underline w-full" onClick={async () => { await logout(); navigate('/login', { replace: true }); }}>
            Se déconnecter
          </button>
        )}
      </div>
    </div>
  );
}
