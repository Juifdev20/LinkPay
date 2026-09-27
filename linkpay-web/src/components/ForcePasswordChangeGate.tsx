import { useState } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/Logo';
import { Loader2, KeyRound } from 'lucide-react';

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
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!user?.must_change_password) return null;

  const canSubmit = newPassword.length >= 8 && newPassword === confirmPassword;

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
    <div className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center gap-6 p-6">
      <Logo size="lg" />
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
        <KeyRound className="w-8 h-8 text-primary" />
      </div>
      <div className="w-full max-w-xs space-y-4">
        <p className="text-muted-foreground text-center text-sm">
          Définissez votre propre mot de passe pour continuer
        </p>
        <div className="space-y-2">
          <Label htmlFor="new_password">Entrez votre nouveau mot de passe</Label>
          <Input
            id="new_password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm_password">Confirmez le nouveau mot de passe</Label>
          <Input
            id="confirm_password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
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
