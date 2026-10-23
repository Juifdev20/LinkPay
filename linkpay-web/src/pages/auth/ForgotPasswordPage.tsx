import { SupportContactList } from '@/components/SupportContactList';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { PhoneInput, isCompletePhone } from '@/components/PhoneInput';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthField } from '@/components/auth/AuthField';
import { ResultView } from '@/components/ResultView';
import { RecoveryCodePanel } from '@/components/auth/RecoveryCodePanel';
import { toApiPhone, displayPhone } from '@/lib/mobile-money';
import { cn } from '@/lib/utils';
import { Loader2, KeyRound, Mail, Lock, ArrowLeft, ArrowRight, MailCheck } from 'lucide-react';

type Method = 'code' | 'email';

/**
 * Forgotten password, without SMS: with the recovery code given at sign-up
 * (phone + code + new password — a new code is then handed out), or by email
 * for the accounts that gave one (a reset link to /reset-password).
 */
export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [method, setMethod] = useState<Method>('code');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState('');

  const recover = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isCompletePhone(phone)) return setError('Saisissez votre numéro : 9 chiffres après +243.');
    if (password.length < 8) return setError('Le nouveau mot de passe doit faire au moins 8 caractères.');
    if (password !== confirm) return setError('Les deux mots de passe ne correspondent pas.');
    setBusy(true);
    try {
      const { data } = await api.post('/auth/recover', { phone: toApiPhone(phone), recovery_code: code, new_password: password });
      setNewCode(data.recovery_code);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Réinitialisation impossible, réessayez.');
    } finally {
      setBusy(false);
    }
  };

  const sendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { data } = await api.post('/auth/forgot-password', { email: email.trim() });
      setEmailSent(data.message);
    } catch (err: any) {
      setError(err?.response?.data?.message || "L'email n'a pas pu être envoyé, réessayez.");
    } finally {
      setBusy(false);
    }
  };

  const shell = { headline: 'Bienvenue sur', switchPrompt: 'Vous vous en souvenez ?', switchLabel: 'Se connecter', switchTo: '/login' };

  if (newCode) {
    return (
      <AuthShell {...shell}>
        <p className="mb-5 rounded-xl bg-success/10 px-4 py-3 text-center text-sm font-semibold text-success">Mot de passe changé avec succès</p>
        <RecoveryCodePanel code={newCode} phone={displayPhone(phone)} doneLabel="Se connecter" onDone={() => navigate('/login')} />
        <p className="mt-4 text-center text-xs text-muted-foreground">Ce nouveau code remplace l'ancien, qui ne fonctionne plus.</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell {...shell} title="Mot de passe oublié" subtitle="Choisissez comment récupérer votre compte ScanLinkPay.">
      <div role="tablist" aria-label="Méthode" className="mb-5 grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1">
        {([['code', 'Code de secours', KeyRound], ['email', 'Par email', Mail]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={method === key}
            onClick={() => { setMethod(key); setError(''); }}
            className={cn(
              'flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-2 py-2.5 text-sm font-semibold transition-all',
              method === key ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="hidden h-4 w-4 shrink-0 min-[400px]:block" /> {label}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="mb-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}

      {method === 'code' ? (
        <form onSubmit={recover}>
          <AuthField id="phone" label="Numéro de téléphone">
            <PhoneInput id="phone" value={phone} onChange={setPhone} className="h-12" />
          </AuthField>
          <AuthField
            id="code"
            label="Code de secours"
            icon={KeyRound}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX-XXXX"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            required
            hint="Le code reçu à l'inscription (ou le dernier reçu)."
          />
          <AuthField id="password" label="Nouveau mot de passe" icon={Lock} password autoComplete="new-password" placeholder="8 caractères minimum" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
          <AuthField id="confirm" label="Confirmer le mot de passe" icon={Lock} password autoComplete="new-password" placeholder="Retapez le mot de passe" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required />
          <Button type="submit" className="mt-3 h-[52px] w-full rounded-xl text-base font-semibold" disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null} Changer le mot de passe
          </Button>
          <p className="mt-4 text-center text-xs leading-relaxed text-muted-foreground">Code de secours perdu ? Utilisez l'email si vous en avez donné un, ou contactez le support ScanLinkPay.</p>
          <SupportContactList quiet className="mt-3" />
        </form>
      ) : emailSent ? (
        <ResultView tone="success" icon={MailCheck} title="Email envoyé" message={<>{emailSent} Ouvrez l'email et suivez le lien pour choisir un nouveau mot de passe.</>} />
      ) : (
        <form onSubmit={sendEmail}>
          <AuthField id="email" label="Email du compte" icon={Mail} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@gmail.com" required hint="Nous y enverrons un lien pour choisir un nouveau mot de passe." />
          <Button type="submit" className="mt-3 h-[52px] w-full rounded-xl text-base font-semibold" disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null} Recevoir le lien
            {!busy && <ArrowRight className="ml-2 h-5 w-5" />}
          </Button>
        </form>
      )}

      <Link to="/login" className="mt-5 flex items-center justify-center gap-1.5 text-sm font-semibold text-primary hover:underline">
        <ArrowLeft className="h-4 w-4" /> Retour à la connexion
      </Link>
    </AuthShell>
  );
}
