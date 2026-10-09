import { useState } from 'react';
import { useAppCodePrompt } from '@/lib/app-code-prompt';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PinInput } from '@/components/PinInput';
import { ShieldCheck } from 'lucide-react';

/** Mounted once in App.tsx: asks for the access code before a sensitive action (stock, inventory, till). */
export function AppCodeConfirmDialog() {
  const { open, message, answer } = useAppCodePrompt();
  const [code, setCode] = useState('');

  const close = (value: string | null) => { setCode(''); answer(value); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary" /> Confirmez avec votre code</DialogTitle>
          <DialogDescription>
            Cette action est sensible (caisse, équipe). Saisissez votre code d'accès à 6 chiffres. Vous ne serez plus redemandé pendant 5 minutes.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-3">
          {message && <p className="text-sm text-destructive font-medium text-center">{message}</p>}
          <PinInput
            key={message}
            value={code}
            length={6}
            autoFocus
            error={!!message}
            onChange={(v) => {
              setCode(v);
              if (v.length === 6) close(v);
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
