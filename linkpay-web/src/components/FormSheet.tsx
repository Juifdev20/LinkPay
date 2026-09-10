import { useEffect } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useSheetStore } from '@/lib/sheet-store';
import { useVisualViewportInset } from '@/hooks/useVisualViewportInset';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';

interface FormSheetProps {
  children: React.ReactNode;
  /** Called on X click, backdrop click, or Escape — pass e.g. `() => navigate(-1)`. */
  onClose: () => void;
  /** Accessible name for the sheet (Radix requires a Dialog.Title descendant).
   * Visually hidden — every form already has its own in-content heading per step. */
  title?: string;
}

/**
 * Shared bottom-sheet shell for every multi-step form in the app (Topup,
 * Send, Withdraw, Pay, SetPin, CreatePaymentRequest, and any future one) —
 * built directly on @radix-ui/react-dialog (a separate variant from
 * components/ui/dialog.tsx's centered Dialog, which two other places in the
 * app already use for small confirm-style popups; this one is bottom-
 * anchored and keyboard-aware instead).
 *
 * Wrap a form's existing step-rendering JSX in this instead of its old
 * `<div className="p-6 max-w-md mx-auto">` wrapper — nothing about the
 * step logic itself needs to change. New forms opt into the same behavior
 * for free by doing the same.
 */
export function FormSheet({ children, onClose, title = 'Formulaire' }: FormSheetProps) {
  const keyboardInset = useVisualViewportInset();
  // Desktop already has its own sidebar navigation (no BottomNav to cover,
  // no on-screen keyboard to dodge) — the native-app bottom-sheet treatment
  // is a mobile-only concern. On desktop this renders as the same kind of
  // centered card these forms used before FormSheet existed.
  const isDesktop = useMediaQuery('(min-width: 768px)');

  // BottomNav hides itself for as long as any FormSheet is mounted (see
  // sheet-store.ts) — registered here so it works regardless of which page
  // renders the sheet. No-op on desktop (BottomNav doesn't render there).
  useEffect(() => {
    useSheetStore.getState().open();
    return () => useSheetStore.getState().close();
  }, []);

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/50 md:backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in data-[state=closed]:animate-out data-[state=closed]:fade-out" />
        <DialogPrimitive.Content
          className={cn(
            'fixed z-[60] flex flex-col bg-card shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out',
            isDesktop
              ? 'left-1/2 top-1/2 w-full max-w-md max-h-[85vh] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-border data-[state=open]:fade-in data-[state=open]:zoom-in-95 data-[state=closed]:fade-out data-[state=closed]:zoom-out-95'
              : 'inset-x-0 rounded-t-3xl safe-area-bottom data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
          )}
          style={
            isDesktop
              ? undefined
              : {
                  // Anchored just above the on-screen keyboard instead of
                  // plain `bottom: 0` — the layout viewport (what CSS
                  // `fixed`/`dvh` normally resolve against) doesn't shrink
                  // when the keyboard opens on Android, so this is driven
                  // from window.visualViewport via
                  // useVisualViewportInset() instead. Not needed on
                  // desktop, which has no on-screen keyboard to dodge.
                  bottom: keyboardInset,
                  maxHeight: `calc(92dvh - ${keyboardInset}px)`,
                }
          }
          onEscapeKeyDown={onClose}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          {/* Drag-handle affordance — implies "swipe to dismiss", a mobile
              sheet convention with no meaning on a centered desktop card. */}
          <div className="flex justify-center pt-3 pb-1 flex-shrink-0 md:hidden">
            <div className="h-1.5 w-10 rounded-full bg-border" />
          </div>
          <DialogPrimitive.Close
            className="absolute right-4 top-4 rounded-full p-1.5 text-muted-foreground hover:bg-accent transition-colors"
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </DialogPrimitive.Close>
          <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
