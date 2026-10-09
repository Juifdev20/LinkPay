import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/lib/auth-store';
import { safeRedirect } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { AuthBrandingPanel } from '@/components/auth/AuthBrandingPanel';
import { Loader2, Mail, Lock, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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
    setLoading(true);
    try {
      await login(email, password, rememberMe, needOtp ? otp.trim() : undefined);
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

  return (
    // The page itself never scrolls: only the form area does, so the branding
    // panel and the browser frame stay fixed (same split as RegisterPage).
    <div className="h-[100dvh] overflow-hidden flex flex-col md:flex-row bg-background">
      <AuthBrandingPanel
        headline="Bienvenue"
        tagline="ScanLinkPay simplifie vos paiements en RDC avec toute sécurité."
        className="h-48 shrink-0 md:h-full md:w-1/2"
      />

      {/* Form section — the only scrollable area. The inner wrapper centres
          the card vertically when there is room and lets it scroll when not. */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 md:p-12 lg:p-16">
        <div className="min-h-full flex items-center justify-center">
        <div className="w-full max-w-md bg-card backdrop-blur-lg rounded-2xl p-6 md:p-8 border border-border shadow-2xl">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">Connexion</h2>
          <p className="text-muted-foreground mb-8 text-sm">
            Connectez-vous à votre compte ScanLinkPay
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="font-semibold text-foreground">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="vous@gmail.com"
                  value={email}
                  onChange={handleEmailChange}
                  required
                  autoFocus
                  className={`pl-10 bg-background border-input text-foreground placeholder:text-muted-foreground focus:bg-accent ${emailError ? 'border-destructive' : ''}`}
                />
              </div>
              {emailError && (
                <p className="text-xs text-destructive mt-1">{emailError}</p>
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
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pl-10 pr-10 bg-background border-input text-foreground placeholder:text-muted-foreground focus:bg-accent"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {needOtp && (
              <div className="space-y-2">
                <Label htmlFor="otp" className="font-semibold text-foreground">Code de l'application d'authentification</Label>
                <Input
                  id="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={11}
                  placeholder="123456 (ou code de secours)"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  required
                  autoFocus
                  className="bg-background border-input text-foreground text-center text-lg tracking-widest"
                />
                <p className="text-xs text-muted-foreground">Ouvrez Google Authenticator (ou équivalent) et saisissez le code à 6 chiffres.</p>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="remember"
                  checked={rememberMe}
                  onCheckedChange={(checked) => setRememberMe(checked as boolean)}
                />
                <Label
                  htmlFor="remember"
                  className="text-sm font-normal text-muted-foreground cursor-pointer"
                >
                  Se souvenir de moi
                </Label>
              </div>
              <Link
                to="/forgot-password"
                className="text-sm text-primary hover:text-primary/80 hover:underline"
              >
                Mot de passe oublié ?
              </Link>
            </div>

            <Button
              type="submit"
              className="w-full py-6 text-base font-semibold rounded-xl"
              disabled={loading}
            >
              {loading && <Loader2 className="mr-2 w-5 h-5 animate-spin" />}
              Se connecter
            </Button>
          </form>

          <p className="text-sm text-muted-foreground text-center mt-6">
            Pas de compte ?{' '}
            <Link
              to={searchParams.get('redirect') ? `/register?redirect=${encodeURIComponent(searchParams.get('redirect')!)}` : '/register'}
              className="text-primary font-semibold hover:text-primary/80 hover:underline"
            >
              Créer un compte
            </Link>
          </p>
        </div>
        </div>
      </div>
    </div>
  );
}

