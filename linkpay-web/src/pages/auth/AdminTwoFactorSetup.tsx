import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { setTokens } from '@/lib/token-storage';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthField } from '@/components/auth/AuthField';
import { Loader2, Copy, Download, Check, KeyRound, LogOut } from 'lucide-react';

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
  const [copied, setCopied] = useState(false);

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

  const signOut = async () => { await logout(); navigate('/login', { replace: true }); };
  const steps = [
    <>Installez <strong className="text-foreground">Google Authenticator</strong> (ou Microsoft Authenticator, Authy…) sur votre téléphone.</>,
    <>Dans l'application, ajoutez un compte en <strong className="text-foreground">scannant ce QR code</strong>.</>,
    <>Saisissez le <strong className="text-foreground">code à 6 chiffres</strong> qu'elle affiche.</>,
  ];

  return (
    <AuthShell
      headline="Administration"
      title={recovery ? 'Vos codes de secours' : 'Sécurisez votre compte'}
      subtitle={recovery
        ? 'Ils permettent de se connecter si vous perdez votre téléphone. Chaque code ne sert qu\'une fois et ne sera plus affiché.'
        : 'Un compte administrateur se protège par un mot de passe et un code de votre téléphone (double authentification).'}
    >
      {error && <p role="alert" className="mb-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}

      {recovery ? (
        <div>
          <div className="grid grid-cols-2 gap-2 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/[0.06] p-4 font-mono text-sm font-semibold text-foreground">
            {recovery.map((c) => <span key={c} className="text-center">{c}</span>)}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <Button variant="outline" className="h-12 rounded-xl" onClick={() => { navigator.clipboard?.writeText(recovery.join('\n')); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              {copied ? <Check className="mr-2 h-4 w-4 text-success" /> : <Copy className="mr-2 h-4 w-4" />}{copied ? 'Copiés' : 'Copier'}
            </Button>
            <Button variant="outline" className="h-12 rounded-xl" onClick={download}><Download className="mr-2 h-4 w-4" />Télécharger</Button>
          </div>
          <Button className="mt-5 h-[52px] w-full rounded-xl text-base font-semibold" onClick={finish}>J'ai sauvegardé mes codes</Button>
        </div>
      ) : status?.enabled ? (
        <div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            La double authentification est déjà activée sur ce compte, mais cette session ne l'a pas utilisée. Reconnectez-vous en saisissant le code de votre application.
          </p>
          <Button className="mt-5 h-[52px] w-full rounded-xl text-base font-semibold" onClick={signOut}>Me reconnecter</Button>
        </div>
      ) : setup ? (
        <form onSubmit={enable}>
          <ol className="space-y-3">
            {steps.map((t, i) => (
              <li key={i} className="flex items-start gap-3 text-sm leading-snug text-muted-foreground">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-xs font-bold text-white">{i + 1}</span>
                <span className="pt-0.5">{t}</span>
              </li>
            ))}
          </ol>
          <div className="mt-5 flex flex-col items-center">
            <img src={setup.qr_data_url} alt="QR code à scanner" className="rounded-2xl border border-border bg-white p-2.5 shadow-soft" width={184} height={184} />
            <p className="mt-2.5 max-w-full break-all text-center text-xs text-muted-foreground">Ou saisissez la clé : <span className="font-mono font-semibold text-foreground">{setup.secret}</span></p>
          </div>
          <AuthField
            id="otp"
            label="Code de l'application"
            icon={KeyRound}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="mt-5"
          />
          <Button type="submit" className="mt-2 h-[52px] w-full rounded-xl text-base font-semibold" disabled={busy || code.length !== 6}>
            {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}Activer
          </Button>
        </form>
      ) : !error ? (
        <div className="flex justify-center py-10"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
      ) : null}

      {!recovery && (
        <button className="mt-5 flex w-full items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" onClick={signOut}>
          <LogOut className="h-4 w-4" /> Se déconnecter
        </button>
      )}
    </AuthShell>
  );
}
