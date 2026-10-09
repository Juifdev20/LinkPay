import { useState } from 'react';
import { useOtpPrompt } from '@/lib/otp-prompt';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ShieldCheck } from 'lucide-react';

/** Mounted once in App.tsx — asks for the authenticator code when an admin action requires it. */
export function OtpPromptDialog() {
  const { open, invalid, answer } = useOtpPrompt();
  const [code, setCode] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = code.trim();
    setCode('');
    answer(value || null);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setCode(''); answer(null); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary" /> Confirmation de sécurité</DialogTitle>
          <DialogDescription>
            Cette action est sensible. Saisissez le code à 6 chiffres de votre application d'authentification.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3 mt-4">
          {invalid && <p className="text-sm text-destructive font-medium">Code incorrect, réessayez.</p>}
          <Input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={11}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="text-center text-xl tracking-widest"
          />
          <Button type="submit" className="w-full" disabled={code.trim().length < 6}>Confirmer</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
