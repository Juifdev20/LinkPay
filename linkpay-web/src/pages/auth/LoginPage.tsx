import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/lib/auth-store';
import { safeRedirect } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthField } from '@/components/auth/AuthField';
import { PhoneInput, isCompletePhone } from '@/components/PhoneInput';
import { toApiPhone } from '@/lib/mobile-money';
import { Loader2, Mail, Lock, KeyRound, ArrowRight } from 'lucide-react';

// Phone number by default; older accounts (and administrators) may log in with their email. Remembered per device.
const MODE_KEY = 'linkpay_login_mode';
const readMode = (): 'phone' | 'email' => {
  try { return localStorage.getItem(MODE_KEY) === 'email' ? 'email' : 'phone'; } catch { return 'phone'; }
};

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const login = useAuthStore((s) => s.login);
  const [mode, setModeState] = useState<'phone' | 'email'>(readMode);
  const setMode = (m: 'phone' | 'email') => {
    setModeState(m);
    setError('');
    try { localStorage.setItem(MODE_KEY, m); } catch { /* not remembered */ }
  };
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem('linkpay_remember_me') !== '0');
  const [emailError, setEmailError] = useState('');
  // Administrator accounts also need the code from their authenticator app.
  const [needOtp, setNeedOtp] = useState(false);
  const [otp, setOtp] = useState('');

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email) {
      setEmailError('');
      return true;
    }
    if (!emailRegex.test(email)) {
      setEmailError('Email invalide');
      return false;
    }
    setEmailError('');
    return true;
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEmail(value);
    validateEmail(value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'phone' && !isCompletePhone(phone)) {
      setError('Saisissez votre numéro : 9 chiffres après +243 (ex. 812 345 678).');
      return;
    }
    setLoading(true);
    try {
      await login(mode === 'phone' ? { phone: toApiPhone(phone) } : { email }, password, rememberMe, needOtp ? otp.trim() : undefined);
      navigate(safeRedirect(searchParams.get('redirect')));
    } catch (err: any) {
      if (err.response?.data?.code === 'OTP_REQUIRED') {
        setNeedOtp(true);
        setError('');
      } else {
        setError(err.response?.data?.message || 'Échec de la connexion');
      }
    } finally {
      setLoading(false);
    }
  };

  const registerLink = searchParams.get('redirect') ? `/register?redirect=${encodeURIComponent(searchParams.get('redirect')!)}` : '/register';

  return (
    <AuthShell
      title="Connexion"
      subtitle="Connectez-vous à votre compte ScanLinkPay et accédez à tous vos services."
      headline="Bienvenue sur"
      switchPrompt="Pas encore de compte ?"
      switchLabel="Créer un compte"
      switchTo={registerLink}
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div role="alert" className="mb-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
            {error}
          </div>
        )}

        {mode === 'phone' ? (
          <AuthField
            id="phone"
            label="Numéro de téléphone"
            hint={<SwitchMode onClick={() => setMode('email')}>Ancien compte ? <b className="font-semibold text-primary">Utiliser l'email</b></SwitchMode>}
          >
            <PhoneInput id="phone" value={phone} onChange={setPhone} className="h-12" />
          </AuthField>
        ) : (
          <AuthField
            id="email"
            label="Email"
            icon={Mail}
            type="email"
            autoComplete="email"
            placeholder="vous@gmail.com"
            value={email}
            onChange={handleEmailChange}
            required
            error={emailError}
            hint={<SwitchMode onClick={() => setMode('phone')}>Se connecter avec le <b className="font-semibold text-primary">numéro de téléphone</b></SwitchMode>}
          />
        )}

        <AuthField
          id="password"
          label="Mot de passe"
          icon={Lock}
          password
          autoComplete="current-password"
          placeholder="Entrez votre mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        {needOtp && (
          <AuthField
            id="otp"
            label="Code de l'application d'authentification"
            icon={KeyRound}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={11}
            placeholder="123456 (ou code de secours)"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            required
            autoFocus
            hint="Le code à 6 chiffres de Google Authenticator (ou équivalent)."
          />
        )}

        <div className="flex items-center justify-between gap-3">
          <label htmlFor="remember" className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              id="remember"
              checked={rememberMe}
              onCheckedChange={(checked) => setRememberMe(checked as boolean)}
            />
            Se souvenir de moi
          </label>
          <Link to="/forgot-password" className="text-sm font-semibold text-primary hover:underline">
            Mot de passe oublié ?
          </Link>
        </div>

        <Button type="submit" className="mt-6 h-[52px] w-full rounded-xl text-base font-semibold" disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
          Se connecter
          {!loading && <ArrowRight className="ml-2 h-5 w-5" />}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> ou <span className="h-px flex-1 bg-border" />
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Vous n'avez pas de compte ?{' '}
        <Link to={registerLink} className="font-semibold text-primary hover:underline">
          Créer un compte
        </Link>
      </p>
    </AuthShell>
  );
}

function SwitchMode({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-muted-foreground hover:text-foreground">
      {children}
    </button>
  );
}
