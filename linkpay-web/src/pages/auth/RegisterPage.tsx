import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { AuthShell } from '@/components/auth/AuthShell';
import { AuthField } from '@/components/auth/AuthField';
import { PhoneInput, isCompletePhone } from '@/components/PhoneInput';
import { RecoveryCodePanel } from '@/components/auth/RecoveryCodePanel';
import { toApiPhone, displayPhone } from '@/lib/mobile-money';
import { Loader2, User, Mail, Lock, Store, Building2, CheckCircle2, ArrowRight } from 'lucide-react';
import { cn, safeRedirect } from '@/lib/utils';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const register = useAuthStore((s) => s.register);
  const [accountType, setAccountType] = useState<'client' | 'merchant' | 'enterprise'>('client');
  const [businessName, setBusinessName] = useState('');
  const [form, setForm] = useState({ email: '', password: '', full_name: '', phone: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');
  // Shown once, right after sign-up, before going on.
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

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

  // The phone number is the account's identifier: required, 9 digits after +243.
  const validatePhone = (digits: string) => {
    if (!isCompletePhone(digits)) {
      setPhoneError('Saisissez 9 chiffres après +243 (ex. 812 345 678)');
      return false;
    }
    setPhoneError('');
    return true;
  };

  const validatePassword = (password: string) => {
    if (!password) {
      setPasswordError('');
      return true;
    }
    if (password.length < 8) {
      setPasswordError('Minimum 8 caractères');
      return false;
    }
    setPasswordError('');
    return true;
  };

  const validateConfirmPassword = (confirmPassword: string) => {
    if (!confirmPassword) {
      setConfirmPasswordError('');
      return true;
    }
    if (confirmPassword !== form.password) {
      setConfirmPasswordError('Les mots de passe ne correspondent pas');
      return false;
    }
    setConfirmPasswordError('');
    return true;
  };

  const calculatePasswordStrength = (password: string): number => {
    if (!password) return 0;
    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password)) strength++;
    return Math.min(strength, 3);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate all fields
    const isEmailValid = validateEmail(form.email);
    const isPhoneValid = validatePhone(form.phone);
    const isPasswordValid = validatePassword(form.password);
    const isConfirmPasswordValid = validateConfirmPassword(form.confirmPassword);

    if (!isEmailValid || !isPhoneValid || !isPasswordValid || !isConfirmPasswordValid) {
      return;
    }

    if (!acceptTerms) {
      setError('Vous devez accepter les CGU et la politique de confidentialité');
      return;
    }

    setLoading(true);
    try {
      const { recovery_code } = await register({
        phone: toApiPhone(form.phone),
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
        password: form.password,
        full_name: form.full_name,
        account_type: accountType,
        ...(accountType === 'merchant' || accountType === 'enterprise' ? { business_name: businessName } : {}),
      });
      if (recovery_code) setRecoveryCode(recovery_code);
      else navigate(safeRedirect(searchParams.get('redirect')));
    } catch (err: any) {
      setError(err.response?.data?.message || "Échec de l'inscription");
    } finally {
      setLoading(false);
    }
  };

  if (recoveryCode) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl md:p-8">
          <RecoveryCodePanel
            code={recoveryCode}
            phone={displayPhone(form.phone)}
            onDone={() => navigate(safeRedirect(searchParams.get('redirect')))}
          />
        </div>
      </div>
    );
  }

  const strength = calculatePasswordStrength(form.password);
  const strengthLabel = ['Faible', 'Moyen', 'Fort', 'Très fort'][strength];
  const strengthColor = ['bg-destructive', 'bg-warning', 'bg-orange-500', 'bg-success'][strength];
  const loginLink = searchParams.get('redirect') ? `/login?redirect=${encodeURIComponent(searchParams.get('redirect')!)}` : '/login';
  const business = accountType === 'merchant' || accountType === 'enterprise';

  return (
    <AuthShell
      title="Créer un compte"
      subtitle="Rejoignez ScanLinkPay et profitez des services sécurisés."
      headline="Rejoignez"
      switchPrompt="Déjà un compte ?"
      switchLabel="Se connecter"
      switchTo={loginLink}
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div role="alert" className="mb-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
            {error}
          </div>
        )}

        <p className="mb-2 text-sm font-semibold text-foreground">Type de compte</p>
        <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="Type de compte">
          {ACCOUNT_TYPES.map(({ value, label, icon: Icon }) => {
            const selected = accountType === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setAccountType(value)}
                className={cn(
                  'relative flex flex-col items-center gap-2 rounded-2xl border-2 px-1 py-3.5 text-sm font-semibold transition-colors',
                  selected
                    ? 'border-primary bg-primary/[0.06] text-primary'
                    : 'border-input text-muted-foreground hover:border-primary/40 hover:bg-accent',
                )}
              >
                {selected && <CheckCircle2 className="absolute right-1.5 top-1.5 h-[18px] w-[18px] fill-primary text-primary-foreground" />}
                <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', selected ? 'bg-brand-gradient text-white' : 'bg-muted text-muted-foreground')}>
                  <Icon className="h-5 w-5" />
                </span>
                {label}
              </button>
            );
          })}
        </div>
        <p className="mb-3 mt-2 min-h-[2rem] text-xs leading-4 text-muted-foreground">
          {ACCOUNT_TYPES.find((t) => t.value === accountType)!.hint}
        </p>

        {business && (
          <AuthField
            id="business_name"
            label={accountType === 'merchant' ? 'Nom de la boutique' : "Nom de l'entreprise"}
            icon={accountType === 'merchant' ? Store : Building2}
            autoComplete="organization"
            placeholder={accountType === 'merchant' ? 'Boutique Mukendi' : 'Doli Hotels'}
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            required
          />
        )}

        <AuthField
          id="full_name"
          label={accountType === 'enterprise' ? 'Nom complet du responsable' : 'Nom complet'}
          icon={User}
          autoComplete="name"
          placeholder="Ex. Dieudonné Merci Jean"
          value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          required
        />

        <AuthField
          id="email"
          label={<>Email <span className="font-normal text-muted-foreground">(facultatif)</span></>}
          icon={Mail}
          type="email"
          autoComplete="email"
          placeholder="vous@exemple.com"
          value={form.email}
          onChange={(e) => {
            setForm({ ...form, email: e.target.value });
            if (emailError) validateEmail(e.target.value);
          }}
          onBlur={(e) => validateEmail(e.target.value)}
          error={emailError}
          hint="Pour récupérer votre compte et recevoir vos reçus."
        />

        <AuthField id="phone" label="Téléphone" error={phoneError} hint="Vous vous connecterez avec ce numéro.">
          <PhoneInput
            id="phone"
            value={form.phone}
            onChange={(digits) => {
              setForm({ ...form, phone: digits });
              if (phoneError) validatePhone(digits);
            }}
            invalid={!!phoneError}
            className="h-12"
          />
        </AuthField>

        {/* The strength line is always there (empty bars before typing): nothing moves under it. */}
        <AuthField
          id="password"
          label="Mot de passe"
          icon={Lock}
          password
          autoComplete="new-password"
          placeholder="8 caractères minimum"
          value={form.password}
          onChange={(e) => {
            setForm({ ...form, password: e.target.value });
            if (passwordError) validatePassword(e.target.value);
          }}
          onBlur={(e) => validatePassword(e.target.value)}
          required
          minLength={8}
          error={passwordError}
          hint={
            <span className="flex items-center gap-2">
              <span className="flex flex-1 gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className={cn('h-1 flex-1 rounded-full transition-colors', form.password && i < Math.max(strength, 1) ? strengthColor : 'bg-border')} />
                ))}
              </span>
              <span className="w-14 text-right">{form.password ? strengthLabel : ''}</span>
            </span>
          }
        />

        <AuthField
          id="confirmPassword"
          label="Confirmer le mot de passe"
          icon={Lock}
          password
          autoComplete="new-password"
          placeholder="Retapez le mot de passe"
          value={form.confirmPassword}
          onChange={(e) => {
            setForm({ ...form, confirmPassword: e.target.value });
            if (confirmPasswordError || e.target.value.length >= form.password.length) validateConfirmPassword(e.target.value);
          }}
          onBlur={(e) => validateConfirmPassword(e.target.value)}
          required
          error={confirmPasswordError}
        />

        <label htmlFor="terms" className="flex cursor-pointer items-start gap-2.5 text-sm leading-snug text-muted-foreground">
          <Checkbox
            id="terms"
            checked={acceptTerms}
            onCheckedChange={(checked) => setAcceptTerms(checked as boolean)}
            className="mt-px"
          />
          <span>
            J'accepte les{' '}
            <Link to="/terms" className="font-semibold text-primary hover:underline">CGU</Link>
            {' '}et la{' '}
            <Link to="/privacy" className="font-semibold text-primary hover:underline">politique de confidentialité</Link>
          </span>
        </label>

        <Button type="submit" className="mt-6 h-[52px] w-full rounded-xl text-base font-semibold" disabled={loading || !acceptTerms}>
          {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
          Créer mon compte
          {!loading && <ArrowRight className="ml-2 h-5 w-5" />}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-muted-foreground">
        Déjà un compte ?{' '}
        <Link to={loginLink} className="font-semibold text-primary hover:underline">
          Se connecter
        </Link>
      </p>
    </AuthShell>
  );
}

const ACCOUNT_TYPES = [
  { value: 'client', label: 'Client', icon: User, hint: 'Pour payer, envoyer et recevoir de l\'argent.' },
  { value: 'merchant', label: 'Marchand', icon: Store, hint: 'Pour recevoir des paiements par lien et QR code.' },
  { value: 'enterprise', label: 'Entreprise', icon: Building2, hint: 'Pour gérer plusieurs boutiques sous une même entreprise.' },
] as const;
