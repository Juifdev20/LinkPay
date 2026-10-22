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
import { Loader2, User, Mail, Lock, Store, Building2, CheckCircle2, ArrowRight, ArrowLeft } from 'lucide-react';
import { cn, safeRedirect } from '@/lib/utils';

const ACCOUNT_TYPES = [
  { value: 'client',     label: 'Client',     icon: User,      hint: "Pour payer, envoyer et recevoir de l'argent." },
  { value: 'merchant',   label: 'Marchand',   icon: Store,     hint: 'Pour recevoir des paiements par lien et QR code.' },
  { value: 'enterprise', label: 'Entreprise', icon: Building2, hint: 'Pour gérer plusieurs boutiques sous une même entreprise.' },
] as const;


export default function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const register = useAuthStore((s) => s.register);

  const [step, setStep] = useState<1 | 2 | 3>(1);
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
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const validateEmail = (email: string) => {
    if (!email) { setEmailError(''); return true; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setEmailError('Email invalide'); return false; }
    setEmailError(''); return true;
  };
  const validatePhone = (digits: string) => {
    if (!isCompletePhone(digits)) { setPhoneError('Saisissez 9 chiffres après +243 (ex. 812 345 678)'); return false; }
    setPhoneError(''); return true;
  };
  const validatePassword = (password: string) => {
    if (!password) { setPasswordError(''); return true; }
    if (password.length < 8) { setPasswordError('Minimum 8 caractères'); return false; }
    setPasswordError(''); return true;
  };
  const validateConfirmPassword = (confirmPassword: string) => {
    if (!confirmPassword) { setConfirmPasswordError(''); return true; }
    if (confirmPassword !== form.password) { setConfirmPasswordError('Les mots de passe ne correspondent pas'); return false; }
    setConfirmPasswordError(''); return true;
  };

  const calculatePasswordStrength = (password: string): number => {
    if (!password) return 0;
    let s = 0;
    if (password.length >= 8) s++;
    if (password.length >= 12) s++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password)) s++;
    return Math.min(s, 3);
  };

  const goBack = () => { setError(''); setStep((s) => (s - 1) as 1 | 2 | 3); };

  const handleStep1Continue = () => {
    setError('');
    if (!form.full_name.trim()) { setError('Saisissez votre nom complet'); return; }
    if (!validatePhone(form.phone)) return;
    // Client : pas de step 2 (pas de boutique ni email obligatoire) → direct step 3
    if (accountType === 'client') { setStep(3); return; }
    setStep(2);
  };

  const handleStep2Continue = () => {
    setError('');
    const business = accountType === 'merchant' || accountType === 'enterprise';
    if (business && !businessName.trim()) { setError(accountType === 'merchant' ? 'Saisissez le nom de la boutique' : "Saisissez le nom de l'entreprise"); return; }
    if (form.email && !validateEmail(form.email)) return;
    setStep(3);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const isEmailValid = validateEmail(form.email);
    const isPasswordValid = validatePassword(form.password);
    const isConfirmPasswordValid = validateConfirmPassword(form.confirmPassword);
    if (!isEmailValid || !isPasswordValid || !isConfirmPasswordValid) return;
    if (!acceptTerms) { setError('Vous devez accepter les CGU et la politique de confidentialité'); return; }
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
      <AuthShell headline="Rejoignez">
        <p className="mb-5 rounded-xl bg-success/10 px-4 py-3 text-center text-sm font-semibold text-success">Votre compte est créé</p>
        <RecoveryCodePanel
          code={recoveryCode}
          phone={displayPhone(form.phone)}
          onDone={() => navigate(safeRedirect(searchParams.get('redirect')))}
        />
      </AuthShell>
    );
  }

  const strength = calculatePasswordStrength(form.password);
  const strengthLabel = ['Faible', 'Moyen', 'Fort', 'Très fort'][strength];
  const strengthColor = ['bg-destructive', 'bg-warning', 'bg-orange-500', 'bg-success'][strength];
  const loginLink = searchParams.get('redirect') ? `/login?redirect=${encodeURIComponent(searchParams.get('redirect')!)}` : '/login';

  const stepTitles = ['Créer un compte', 'Votre activité', 'Sécurité'];
  // Client saute l'étape 2 → les pastilles affichent 2 étapes seulement pour lui
  const totalSteps = accountType === 'client' ? 2 : 3;
  // Numéro d'étape affiché (client : step 3 s'affiche comme étape 2)
  const displayStep = accountType === 'client' && step === 3 ? 2 : step;

  return (
    <AuthShell
      title={step === 3 && accountType === 'client' ? stepTitles[2] : stepTitles[step - 1]}
      headline="Rejoignez"
      switchPrompt="Déjà un compte ?"
      switchLabel="Se connecter"
      switchTo={loginLink}
    >
      <div className="mb-3 flex items-center gap-2">
        {step > 1 && (
          <button type="button" onClick={goBack} className="flex items-center text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="flex flex-1 items-center justify-center">
          {Array.from({ length: totalSteps }, (_, i) => {
            const n = i + 1;
            const done = n < displayStep;
            const active = n === displayStep;
            return (
              <div key={n} className="flex items-center">
                <div className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition-colors',
                  active ? 'bg-primary text-primary-foreground' :
                  done   ? 'bg-primary/20 text-primary' :
                           'bg-muted text-muted-foreground',
                )}>
                  {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
                </div>
                {n < totalSteps && <div className={cn('h-px w-7 transition-colors', n < displayStep ? 'bg-primary/40' : 'bg-border')} />}
              </div>
            );
          })}
        </div>
        {step > 1 && <div className="w-5" />}
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
          {error}
        </div>
      )}

      {/* ── ÉTAPE 1 : type + identité de base ── */}
      {step === 1 && (
        <div>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Type de compte">
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
                    'relative flex flex-col items-center gap-1.5 rounded-2xl border-2 px-1 py-3 text-xs font-semibold transition-colors',
                    selected
                      ? 'border-primary bg-primary/[0.06] text-primary'
                      : 'border-input text-muted-foreground hover:border-primary/40 hover:bg-accent',
                  )}
                >
                  {selected && <CheckCircle2 className="absolute right-1.5 top-1.5 h-4 w-4 fill-primary text-primary-foreground" />}
                  <span className={cn('flex h-8 w-8 items-center justify-center rounded-xl', selected ? 'bg-brand-gradient text-white' : 'bg-muted text-muted-foreground')}>
                    <Icon className="h-4 w-4" />
                  </span>
                  {label}
                </button>
              );
            })}
          </div>
          <p className="mb-1 mt-1.5 hidden text-xs leading-4 text-muted-foreground sm:block">
            {ACCOUNT_TYPES.find((t) => t.value === accountType)!.hint}
          </p>
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
          <AuthField id="phone" label="Téléphone" error={phoneError} hint="Vous vous connecterez avec ce numéro.">
            <PhoneInput
              id="phone"
              value={form.phone}
              onChange={(digits) => { setForm({ ...form, phone: digits }); if (phoneError) validatePhone(digits); }}
              invalid={!!phoneError}
              className="h-12"
            />
          </AuthField>
          <Button type="button" className="mt-2 h-[52px] w-full rounded-xl text-base font-semibold" onClick={handleStep1Continue}>
            Continuer <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      )}

      {/* ── ÉTAPE 2 : boutique/entreprise + email (marchand & entreprise seulement) ── */}
      {step === 2 && (
        <div>
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
          <AuthField
            id="email2"
            label={<>Email <span className="font-normal text-muted-foreground">(facultatif)</span></>}
            icon={Mail}
            type="email"
            autoComplete="email"
            placeholder="vous@exemple.com"
            value={form.email}
            onChange={(e) => { setForm({ ...form, email: e.target.value }); if (emailError) validateEmail(e.target.value); }}
            onBlur={(e) => validateEmail(e.target.value)}
            error={emailError}
            hint="Pour récupérer votre compte et recevoir vos reçus."
          />
          <Button type="button" className="mt-2 h-[52px] w-full rounded-xl text-base font-semibold" onClick={handleStep2Continue}>
            Continuer <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      )}

      {/* ── ÉTAPE 3 : sécurité ── */}
      {step === 3 && (
        <form onSubmit={handleSubmit}>
          {/* Email : uniquement pour les clients (marchand/entreprise l'ont renseigné à l'étape 2) */}
          {accountType === 'client' && (
            <AuthField
              id="email"
              label={<>Email <span className="font-normal text-muted-foreground">(facultatif)</span></>}
              icon={Mail}
              type="email"
              autoComplete="email"
              placeholder="vous@exemple.com"
              value={form.email}
              onChange={(e) => { setForm({ ...form, email: e.target.value }); if (emailError) validateEmail(e.target.value); }}
              onBlur={(e) => validateEmail(e.target.value)}
              error={emailError}
              hint="Pour récupérer votre compte et recevoir vos reçus."
            />
          )}
          <AuthField
            id="password"
            label="Mot de passe"
            icon={Lock}
            password
            autoComplete="new-password"
            placeholder="8 caractères minimum"
            value={form.password}
            onChange={(e) => { setForm({ ...form, password: e.target.value }); if (passwordError) validatePassword(e.target.value); }}
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
            onChange={(e) => { setForm({ ...form, confirmPassword: e.target.value }); if (confirmPasswordError || e.target.value.length >= form.password.length) validateConfirmPassword(e.target.value); }}
            onBlur={(e) => validateConfirmPassword(e.target.value)}
            required
            error={confirmPasswordError}
          />
          <label htmlFor="terms" className="flex cursor-pointer items-start gap-2.5 text-sm leading-snug text-muted-foreground">
            <Checkbox id="terms" checked={acceptTerms} onCheckedChange={(checked) => setAcceptTerms(checked as boolean)} className="mt-px" />
            <span>
              J'accepte les{' '}
              <Link to="/terms" className="font-semibold text-primary hover:underline">CGU</Link>
              {' '}et la{' '}
              <Link to="/privacy" className="font-semibold text-primary hover:underline">politique de confidentialité</Link>
            </span>
          </label>
          <Button type="submit" className="mt-5 h-[52px] w-full rounded-xl text-base font-semibold" disabled={loading || !acceptTerms}>
            {loading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : null}
            Créer mon compte
            {!loading && <ArrowRight className="ml-2 h-5 w-5" />}
          </Button>
        </form>
      )}

      <p className="mt-5 text-center text-sm text-muted-foreground">
        Déjà un compte ?{' '}
        <Link to={loginLink} className="font-semibold text-primary hover:underline">Se connecter</Link>
      </p>
    </AuthShell>
  );
}
