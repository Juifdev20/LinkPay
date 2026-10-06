import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/auth-store';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/Logo';
import { Loader2, KeyRound, Eye, EyeOff, Building2 } from 'lucide-react';
import { SECTORS } from '@/pages/organization/OnboardingWizard';

/**
 * Full-screen overlay mounted once at the app root (see App.tsx), same
 * pattern as AppLockGate — blocks every dashboard route until the
 * account's forced first-login password change is done. Set on accounts
 * created via OrganizationStaffController (organization-staff module);
 * profiles.must_change_password comes back on login()/fetchProfile().
 */
export function ForcePasswordChangeGate() {
  const user = useAuthStore((s) => s.user);
  const clearMustChangePassword = useAuthStore((s) => s.clearMustChangePassword);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Same query key/endpoint as DashboardLayout's sidebar — /organizations/me
  // resolves for org-staff too (falls back to their organization_id claim,
  // not just the owner), so this works for the staff accounts this gate is
  // actually built for.
  const { data: org } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
    enabled: !!user?.organization_id,
  });

  if (!user?.must_change_password) return null;

  const lengthOk = newPassword.length >= 8;
  const matchOk = confirmPassword.length === 0 || newPassword === confirmPassword;
  const canSubmit = lengthOk && confirmPassword.length > 0 && newPassword === confirmPassword;

  const calculateStrength = (password: string): number => {
    if (!password) return 0;
    let strength = 0;
    if (password.length >= 8) strength++;
    if (password.length >= 12) strength++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password)) strength++;
    return Math.min(strength, 3);
  };
  const strength = calculateStrength(newPassword);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      await api.put('/auth/change-password', { new_password: newPassword });
      clearMustChangePassword();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Échec du changement de mot de passe. Réessayez.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center gap-6 p-6 overflow-y-auto">
      <div className="flex flex-col items-center gap-2">
        <Logo size="lg" />
        {org && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Building2 className="w-4 h-4" />
            <span>
              {SECTORS.find((s) => s.value === org.sector)?.label || org.sector}
              {org.sector && org.name ? ' — ' : ''}
              {org.name}
            </span>
          </div>
        )}
      </div>
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
        <KeyRound className="w-8 h-8 text-primary" />
      </div>
      <div className="w-full max-w-xs space-y-4">
        <p className="text-muted-foreground text-center text-sm">
          Définissez votre propre mot de passe pour continuer
        </p>
        <div className="space-y-2">
          <Label htmlFor="new_password">Entrez votre nouveau mot de passe</Label>
          <div className="relative">
            <Input
              id="new_password"
              type={showPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {newPassword && !lengthOk && (
            <p className="text-xs text-destructive">Minimum 8 caractères</p>
          )}
          {newPassword && (
            <div className="mt-1">
              <div className="flex gap-1">
                {[0, 1, 2].map((index) => (
                  <div
                    key={index}
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      index < strength
                        ? strength === 1
                          ? 'bg-warning'
                          : strength === 2
                          ? 'bg-orange-500'
                          : 'bg-success'
                        : 'bg-border'
                    }`}
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {strength === 0 && 'Faible'}
                {strength === 1 && 'Moyen'}
                {strength === 2 && 'Fort'}
                {strength === 3 && 'Très fort'}
              </p>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm_password">Confirmez le nouveau mot de passe</Label>
          <div className="relative">
            <Input
              id="confirm_password"
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              tabIndex={-1}
            >
              {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {!matchOk && (
            <p className="text-xs text-destructive">Les mots de passe ne correspondent pas</p>
          )}
        </div>
        {error && <p className="text-sm text-destructive text-center">{error}</p>}
        <Button className="w-full" disabled={!canSubmit || submitting} onClick={handleSubmit}>
          {submitting && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
          Continuer
        </Button>
      </div>
    </div>
  );
}
