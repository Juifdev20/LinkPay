import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/lib/auth-store';
import { safeRedirect } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Logo } from '@/components/Logo';
import { Loader2, Mail, Lock, ArrowRight, Eye, EyeOff, QrCode } from 'lucide-react';

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [emailError, setEmailError] = useState('');

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
      await login(email, password);
      navigate(safeRedirect(searchParams.get('redirect')));
    } catch (err: any) {
      setError(err.response?.data?.message || 'Échec de la connexion');
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
              Bienvenue !
            </h1>
            <p className="text-lg text-muted-foreground mb-8 max-w-lg leading-relaxed">
              LinkPay simplifie vos paiements en RDC. Créez des liens de paiement instantanés, générez des QR codes et encaissez vos fonds en toute sécurité.
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

        {/* Right Section - Login Form */}
        <div className="w-full md:w-1/2 flex items-center justify-center p-4 md:p-12 lg:p-16">
          {/* max-h + flex-col + only the form scrolling internally keeps the
              card from ever overflowing the viewport, on mobile or desktop,
              while the heading/logo and the footer link stay put — same
              "fixed chrome, scrolling middle" pattern as FormSheet.tsx. */}
          <div className="w-full max-w-md bg-card backdrop-blur-lg rounded-2xl border border-border shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">
            <div className="px-6 md:px-8 pt-6 md:pt-8 pb-2 flex-shrink-0">
              {/* Desktop already shows the logo in the left branding panel —
                  this is only for mobile, where that panel is hidden. */}
              <div className="md:hidden mb-6 flex justify-center">
                <Logo size="sm" />
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">Connexion</h2>
              <p className="text-muted-foreground text-sm">
                Connectez-vous à votre compte LinkPay
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-6 md:px-8 py-4">
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
                    placeholder="vous@exemple.com"
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
                  className="text-sm text-primary hover:text-secondary hover:underline"
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
            </div>

            <div className="px-6 md:px-8 pb-6 md:pb-8 pt-4 flex-shrink-0">
              <p className="text-sm text-muted-foreground text-center">
                Pas de compte ?{' '}
                <Link
                  to={searchParams.get('redirect') ? `/register?redirect=${encodeURIComponent(searchParams.get('redirect')!)}` : '/register'}
                  className="text-primary font-semibold hover:text-secondary hover:underline"
                >
                  Créer un compte
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

