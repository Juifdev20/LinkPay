import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PhoneInput, isCompletePhone } from '@/components/PhoneInput';
import { RecoveryCodePanel } from '@/components/auth/RecoveryCodePanel';
import { toApiPhone, displayPhone } from '@/lib/mobile-money';
import { cn } from '@/lib/utils';
import { Loader2, KeyRound, Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';

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

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl md:p-8">
        {newCode ? (
          <div className="space-y-4">
            <p className="flex items-center justify-center gap-2 rounded-xl bg-success/10 px-4 py-3 text-sm font-medium text-success">
              <CheckCircle2 className="h-4 w-4" /> Mot de passe changé
            </p>
            <RecoveryCodePanel
              code={newCode}
              phone={displayPhone(phone)}
              doneLabel="Se connecter"
              onDone={() => navigate('/login')}
            />
            <p className="text-center text-xs text-muted-foreground">Ce nouveau code remplace l'ancien, qui ne fonctionne plus.</p>
          </div>
        ) : (
          <>
            <Link to="/login" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" /> Retour à la connexion
            </Link>
            <h1 className="text-2xl font-bold text-foreground">Mot de passe oublié</h1>
            <p className="mt-1 mb-5 text-sm text-muted-foreground">Choisissez comment récupérer votre compte.</p>

            <div className="mb-5 grid grid-cols-2 gap-2">
              {([['code', 'Code de secours', KeyRound], ['email', 'Par email', Mail]] as const).map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setMethod(key); setError(''); }}
                  className={cn('flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-3 text-sm font-semibold',
                    method === key ? 'border-primary bg-primary/5 text-primary' : 'border-input text-muted-foreground hover:bg-accent')}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>

            {error && <p className="mb-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">{error}</p>}

            {method === 'code' ? (
              <form onSubmit={recover} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="phone" className="font-semibold">Numéro de téléphone</Label>
                  <PhoneInput id="phone" value={phone} onChange={setPhone} autoFocus />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="code" className="font-semibold">Code de secours</Label>
                  <Input id="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" autoCapitalize="characters" autoComplete="off" className="font-mono tracking-widest" required />
                  <p className="text-xs text-muted-foreground">Le code donné à votre inscription (ou le dernier que vous avez reçu).</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="font-semibold">Nouveau mot de passe</Label>
                  <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm" className="font-semibold">Confirmer le mot de passe</Label>
                  <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required />
                </div>
                <Button type="submit" className="w-full py-6 text-base font-semibold" disabled={busy}>
                  {busy && <Loader2 className="mr-2 h-5 w-5 animate-spin" />} Changer le mot de passe
                </Button>
                <p className="text-center text-xs text-muted-foreground">Code de secours perdu ? Utilisez l'email si vous en avez donné un, ou contactez le support ScanLinkPay.</p>
              </form>
            ) : emailSent ? (
              <p className="rounded-xl bg-success/10 px-4 py-4 text-sm text-success">{emailSent} Ouvrez l'email et suivez le lien.</p>
            ) : (
              <form onSubmit={sendEmail} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="font-semibold">Email du compte</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@gmail.com" required autoFocus />
                </div>
                <Button type="submit" className="w-full py-6 text-base font-semibold" disabled={busy}>
                  {busy && <Loader2 className="mr-2 h-5 w-5 animate-spin" />} Recevoir le lien
                </Button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
