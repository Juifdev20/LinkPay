import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Logo } from '@/components/Logo';
import { Loader2, User, Mail, Phone, Lock, Store, ArrowRight, Eye, EyeOff, QrCode } from 'lucide-react';
import { cn, safeRedirect } from '@/lib/utils';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const register = useAuthStore((s) => s.register);
  const [accountType, setAccountType] = useState<'client' | 'merchant'>('client');
  const [businessName, setBusinessName] = useState('');
  const [form, setForm] = useState({ email: '', password: '', full_name: '', phone: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');

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

  const validatePhone = (phone: string) => {
    if (!phone) {
      setPhoneError('');
      return true;
    }
    const phoneRegex = /^\+243\s?\d{3}\s?\d{3}\s?\d{3}$/;
    if (!phoneRegex.test(phone)) {
      setPhoneError('Format: +243 XXX XXX XXX');
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
      await register({
        ...form,
        account_type: accountType,
        ...(accountType === 'merchant' ? { business_name: businessName } : {}),
      });
      navigate(safeRedirect(searchParams.get('redirect')));
    } catch (err: any) {
      setError(err.response?.data?.message || "Échec de l'inscription");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-background">
      {/* Background with abstract shapes */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-secondary/10 to-background">
        <div className="absolute top-20 left-20 w-72 h-72 bg-primary/20 rounded-full blur-3xl" />
        <div className="absolute bottom-20 right-20 w-96 h-96 bg-secondary/20 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full min-h-screen flex flex-col md:flex-row">
        {/* Left Section - Welcome (Desktop only) */}
        <div className="hidden md:flex w-1/2 flex-col justify-center p-12 lg:p-16 relative">
          {/* Large QR Code Background */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] opacity-5">
            <QrCode className="w-full h-full text-primary" />
          </div>

          <div className="relative z-10">
            <div className="mb-8">
              <Logo size="lg" />
            </div>
            <h1 className="text-5xl lg:text-6xl font-bold text-foreground mb-6">
              Créer un compte
            </h1>
            <p className="text-lg text-muted-foreground mb-8 max-w-lg leading-relaxed">
              Rejoignez LinkPay en quelques secondes. Commencez à recevoir des paiements instantanés dès aujourd'hui.
            </p>
            <Button
              asChild
              className="w-fit px-8 py-6 text-base font-semibold rounded-xl"
            >
              <Link to="/">
                En savoir plus
                <ArrowRight className="ml-2 w-5 h-5" />
              </Link>
            </Button>
          </div>
        </div>

        {/* Right Section - Register Form */}
        <div className="w-full md:w-1/2 flex items-center justify-center p-4 md:p-12 lg:p-16">
          {/* max-h + flex-col + only the form scrolling internally keeps the
              card from ever overflowing the viewport, on mobile or desktop —
              this form in particular has grown long (confirm password,
              strength meter, terms checkbox), so this matters more here than
              on LoginPage. Same "fixed chrome, scrolling middle" pattern as
              FormSheet.tsx. */}
          <div className="w-full max-w-md bg-card backdrop-blur-lg rounded-2xl border border-border shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-6 md:px-8 pt-6 md:pt-8 pb-2 flex-shrink-0">
              {/* Desktop already shows the logo in the left branding panel —
                  this is only for mobile, where that panel is hidden. */}
              <div className="md:hidden mb-6 flex justify-center">
                <Logo size="sm" />
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">Inscription</h2>
              <p className="text-muted-foreground text-sm">
                Rejoignez LinkPay en quelques secondes
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-6 md:px-8 py-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <Label className="font-semibold text-foreground">Type de compte</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setAccountType('client')}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-xl border-2 px-4 py-4 text-sm font-semibold transition-colors',
                      accountType === 'client'
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-input text-muted-foreground hover:bg-accent',
                    )}
                  >
                    <User className="w-8 h-8" />
                    Client
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountType('merchant')}
                    className={cn(
                      'flex flex-col items-center gap-2 rounded-xl border-2 px-4 py-4 text-sm font-semibold transition-colors',
                      accountType === 'merchant'
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-input text-muted-foreground hover:bg-accent',
                    )}
                  >
                    <Store className="w-8 h-8" />
                    Marchand
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {accountType === 'client'
                    ? 'Pour payer des commerçants LinkPay.'
                    : 'Pour recevoir des paiements via lien et QR code.'}
                </p>
              </div>

              {accountType === 'merchant' && (
                <div className="space-y-2">
                  <Label htmlFor="business_name" className="font-semibold text-foreground">Nom de la boutique</Label>
                  <div className="relative">
                    <Store className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="business_name"
                      placeholder="Boutique Mukendi"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      required
                      className="pl-10 bg-background border-input text-foreground placeholder:text-muted-foreground focus:bg-accent"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="full_name" className="font-semibold text-foreground">Nom complet</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="full_name"
                    placeholder="Dieudonne Merci Jean"
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                    required
                    className="pl-10 bg-background border-input text-foreground placeholder:text-muted-foreground focus:bg-accent"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="font-semibold text-foreground">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="vous@exemple.com"
                    value={form.email}
                    onChange={(e) => {
                      setForm({ ...form, email: e.target.value });
                      validateEmail(e.target.value);
                    }}
                    required
                    className={`pl-10 bg-background border-input text-foreground placeholder:text-muted-foreground focus:bg-accent ${emailError ? 'border-destructive' : ''}`}
                  />
                </div>
                {emailError && (
                  <p className="text-xs text-destructive mt-1">{emailError}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone" className="font-semibold text-foreground">Téléphone</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="phone"
                    placeholder="+243 8XX XXX XXX"
                    value={form.phone}
                    onChange={(e) => {
                      setForm({ ...form, phone: e.target.value });
                      validatePhone(e.target.value);
                    }}
                    className={`pl-10 bg-background border-input text-foreground placeholder:text-muted-foreground focus:bg-accent ${phoneError ? 'border-destructive' : ''}`}
                  />
                </div>
                {phoneError && (
                  <p className="text-xs text-destructive mt-1">{phoneError}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="font-semibold text-foreground">Mot de passe</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={form.password}
                    onChange={(e) => {
                      setForm({ ...form, password: e.target.value });
                      validatePassword(e.target.value);
                    }}
                    required
                    minLength={8}
                    className={`pl-10 pr-10 bg-background border-input text-foreground placeholder:text-muted-foreground focus:bg-accent ${passwordError ? 'border-destructive' : ''}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {passwordError && (
                  <p className="text-xs text-destructive mt-1">{passwordError}</p>
                )}
                {/* Password Strength Indicator */}
                {form.password && (
                  <div className="mt-2">
                    <div className="flex gap-1">
                      {[0, 1, 2].map((index) => (
                        <div
                          key={index}
                          className={`h-1 flex-1 rounded-full transition-colors ${
                            index < calculatePasswordStrength(form.password)
                              ? calculatePasswordStrength(form.password) === 1
                                ? 'bg-warning'
                                : calculatePasswordStrength(form.password) === 2
                                ? 'bg-orange-500'
                                : 'bg-success'
                              : 'bg-border'
                          }`}
                        />
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {calculatePasswordStrength(form.password) === 0 && 'Faible'}
                      {calculatePasswordStrength(form.password) === 1 && 'Moyen'}
                      {calculatePasswordStrength(form.password) === 2 && 'Fort'}
                      {calculatePasswordStrength(form.password) === 3 && 'Très fort'}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="font-semibold text-foreground">Confirmer le mot de passe</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={form.confirmPassword}
                    onChange={(e) => {
                      setForm({ ...form, confirmPassword: e.target.value });
                      validateConfirmPassword(e.target.value);
                    }}
                    required
                    className={`pl-10 pr-10 bg-background border-input text-foreground placeholder:text-muted-foreground focus:bg-accent ${confirmPasswordError ? 'border-destructive' : ''}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {confirmPasswordError && (
                  <p className="text-xs text-destructive mt-1">{confirmPasswordError}</p>
                )}
              </div>

              <div className="flex items-start space-x-2">
                <Checkbox
                  id="terms"
                  checked={acceptTerms}
                  onCheckedChange={(checked) => setAcceptTerms(checked as boolean)}
                />
                <Label
                  htmlFor="terms"
                  className="text-sm font-normal text-muted-foreground cursor-pointer leading-tight"
                >
                  J'accepte les{' '}
                  <Link to="/terms" className="text-primary hover:text-primary/80 hover:underline">
                    CGU
                  </Link>{' '}
                  et la{' '}
                  <Link to="/privacy" className="text-primary hover:text-primary/80 hover:underline">
                    politique de confidentialité
                  </Link>
                </Label>
              </div>

              <Button type="submit" className="w-full py-6 text-base font-semibold rounded-xl" disabled={loading}>
                {loading && <Loader2 className="mr-2 w-5 h-5 animate-spin" />}
                Créer mon compte
              </Button>
            </form>
            </div>

            <div className="px-6 md:px-8 pb-6 md:pb-8 pt-4 flex-shrink-0">
              <p className="text-sm text-muted-foreground text-center">
                Déjà un compte ?{' '}
                <Link
                  to={searchParams.get('redirect') ? `/login?redirect=${encodeURIComponent(searchParams.get('redirect')!)}` : '/login'}
                  className="text-primary font-semibold hover:text-primary/80 hover:underline"
                >
                  Se connecter
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
