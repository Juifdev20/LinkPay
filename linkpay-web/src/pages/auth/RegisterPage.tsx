import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Logo } from '@/components/Logo';
import { Loader2, User, Mail, Phone, Lock, Store } from 'lucide-react';
import { cn, safeRedirect } from '@/lib/utils';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const register = useAuthStore((s) => s.register);
  const [accountType, setAccountType] = useState<'client' | 'merchant'>('client');
  const [businessName, setBusinessName] = useState('');
  const [form, setForm] = useState({ email: '', password: '', full_name: '', phone: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
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
    <div className="min-h-screen flex items-center justify-center px-4 py-8 bg-background">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Logo size="lg" />
        </div>
        <Card>
          <CardContent className="pt-6">
            <h1 className="text-2xl font-bold text-center text-foreground mb-1">Créer un compte</h1>
            <p className="text-sm text-center text-muted-foreground mb-6">
              Rejoignez LinkPay en quelques secondes
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label className="font-semibold">Type de compte</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setAccountType('client')}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-colors',
                      accountType === 'client'
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-input text-muted-foreground hover:bg-accent',
                    )}
                  >
                    <User className="w-5 h-5" />
                    Client
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountType('merchant')}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-xl border-2 px-4 py-3 text-sm font-semibold transition-colors',
                      accountType === 'merchant'
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-input text-muted-foreground hover:bg-accent',
                    )}
                  >
                    <Store className="w-5 h-5" />
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
                  <Label htmlFor="business_name" className="font-semibold">Nom de la boutique</Label>
                  <div className="relative">
                    <Store className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="business_name"
                      placeholder="Boutique Mukendi"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      required
                      className="pl-10"
                    />
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="full_name" className="font-semibold">Nom complet</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="full_name"
                    placeholder="Dieudonne Merci Jean"
                    value={form.full_name}
                    onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                    required
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="font-semibold">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="vous@exemple.com"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone" className="font-semibold">Téléphone (optionnel)</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="phone"
                    placeholder="+243 8XX XXX XXX"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="font-semibold">Mot de passe</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required
                    minLength={8}
                    className="pl-10"
                  />
                </div>
              </div>
              <Button type="submit" className="w-full" size="lg" disabled={loading}>
                {loading && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                Créer mon compte
              </Button>
            </form>
          </CardContent>
          <CardFooter className="flex justify-center">
            <p className="text-sm text-muted-foreground text-center">
              Déjà un compte ?{' '}
              <Link
                to={searchParams.get('redirect') ? `/login?redirect=${encodeURIComponent(searchParams.get('redirect')!)}` : '/login'}
                className="text-primary font-semibold hover:underline"
              >
                Se connecter
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
