import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/Logo';

/**
 * Mobile-only entry screen for unauthenticated visitors (see App.tsx's
 * RootRedirect — desktop skips straight to /login). As in the 2026 design: the logo, a short welcome, the two
 * ways in, and the brand waves at the bottom — light or dark with the phone's theme.
 */
export default function WelcomePage() {
  return (
    <div className="min-h-[100dvh] flex flex-col relative overflow-hidden bg-background safe-area-top safe-area-bottom">
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-8 pt-12 gap-6">
        <div className="flex flex-col items-center gap-3">
          <Logo size="xl" showText={false} imgClassName="w-20 h-20 rounded-[22px] shadow-brand" />
          <p className="text-3xl font-extrabold tracking-tight text-foreground">
            ScanLink<span className="text-brand-sky">Pay</span>
          </p>
        </div>
        <div className="space-y-3">
          <h1 className="text-2xl font-bold leading-snug text-foreground">
            Bienvenue sur
            <br />
            <span className="text-brand-gradient">ScanLinkPay</span>
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground max-w-[17rem] mx-auto">
            Transférez, payez, rechargez et gérez votre argent en toute simplicité.
          </p>
        </div>
        <div className="w-full max-w-sm flex flex-col gap-3 pt-2">
          <Button asChild className="w-full h-12 rounded-2xl text-base">
            <Link to="/register">Commencer</Link>
          </Button>
          <Button asChild variant="outline" className="w-full h-12 rounded-2xl text-base border-primary text-primary bg-transparent hover:bg-primary/5">
            <Link to="/login">Se connecter</Link>
          </Button>
        </div>
      </div>

      {/* Brand waves, as in the design. */}
      <svg className="relative w-full h-56 flex-shrink-0 -mt-6" viewBox="0 0 400 220" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="wl-1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1230f8" stopOpacity="0.3" />
            <stop offset="1" stopColor="#0ea5e9" stopOpacity="0.25" />
          </linearGradient>
          <linearGradient id="wl-2" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#0a1270" />
            <stop offset="1" stopColor="#1230f8" />
          </linearGradient>
        </defs>
        <path d="M0 70 C 60 10, 130 40, 180 80 S 300 150, 400 60 L 400 220 L 0 220 Z" fill="url(#wl-1)" />
        <path d="M0 120 C 80 70, 150 110, 220 130 S 340 140, 400 100 L 400 220 L 0 220 Z" fill="#4a63ff" fillOpacity="0.5" />
        <path d="M0 165 C 90 130, 170 175, 250 165 S 360 140, 400 150 L 400 220 L 0 220 Z" fill="url(#wl-2)" />
      </svg>
    </div>
  );
}
