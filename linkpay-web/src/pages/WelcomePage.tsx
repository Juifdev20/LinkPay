import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/Logo';

/**
 * Mobile-only entry screen for unauthenticated visitors (see App.tsx's
 * RootRedirect — desktop skips straight to /login, matching the reference
 * design where the desktop layout already combines the branding panel and
 * the form in one screen). A brand-color splash with a short pitch and the
 * two ways in, not a marketing site — that's the distinction from the
 * feature-grid landing page that used to live at "/".
 */
export default function WelcomePage() {
  return (
    <div className="min-h-[100dvh] flex flex-col relative overflow-hidden bg-gradient-to-br from-primary to-primary/80 px-6 py-10 safe-area-top safe-area-bottom">
      <div className="absolute -top-1/4 -left-1/4 w-[80%] h-[80%] bg-secondary/10 rounded-full blur-3xl" />
      <div className="absolute -bottom-1/4 -right-1/4 w-[80%] h-[80%] bg-background/10 rounded-full blur-3xl" />

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center gap-5">
        <div className="w-20 h-20 rounded-full bg-background flex items-center justify-center shadow-lg">
          <Logo size="sm" showText={false} imgClassName="w-12 h-12 rounded-lg" />
        </div>
        <div>
          <p className="text-primary-foreground/80 text-lg">Bienvenue sur</p>
          <h1 className="text-4xl font-bold text-primary-foreground">LinkPay</h1>
        </div>
        <p className="text-primary-foreground/80 text-sm max-w-xs leading-relaxed">
          Encaissez et payez vos factures en toute simplicité, partout en RDC avec un simple liens de paiement, QR code et portefeuille mobile.
        </p>
      </div>

      <div className="relative z-10 flex flex-col gap-3 mb-8">
        <Button asChild className="w-full py-6 text-base font-semibold rounded-xl bg-background text-primary hover:bg-background/90">
          <Link to="/register">Créer un compte</Link>
        </Button>
        <Button
          asChild
          variant="outline"
          className="w-full py-6 text-base font-semibold rounded-xl border-primary-foreground/40 text-primary-foreground bg-transparent hover:bg-background/10"
        >
          <Link to="/login">Se connecter</Link>
        </Button>
      </div>
    </div>
  );
}
