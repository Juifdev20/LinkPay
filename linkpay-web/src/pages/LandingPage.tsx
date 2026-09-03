import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/Logo';
import { cn } from '@/lib/utils';
import { QrCode, Wallet, Shield, ArrowRight, Zap, Smartphone } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="container flex items-center justify-between h-16">
          <Logo size="md" />
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link to="/login">Connexion</Link>
            </Button>
            <Button asChild>
              <Link to="/register">S'inscrire</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
        <div className="container relative py-20 md:py-32 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-sm text-primary font-medium mb-6 animate-fade-in">
            <Zap className="w-3.5 h-3.5" />
            Paiements par lien en RDC
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6 text-foreground animate-slide-up">
            Encaissez par <span className="text-primary">lien</span> et <span className="text-primary">QR code</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-8 animate-slide-up">
            LinkPay permet aux commerçants de créer des demandes de paiement instantanées.
            Partagez un lien, scannez un QR code, recevez vos fonds.
          </p>
          <div className="flex items-center justify-center gap-3 animate-slide-up">
            <Button size="lg" asChild>
              <Link to="/register">
                Créer un compte
                <ArrowRight className="ml-2 w-4 h-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link to="/login">Se connecter</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="container py-16 grid md:grid-cols-3 gap-6">
        {[
          { icon: QrCode, title: 'Paiements par QR Code', desc: 'Générez un QR code instantanément. Vos clients scannent et paient en quelques secondes.', tint: 'primary' },
          { icon: Wallet, title: 'Règlements automatiques', desc: 'Suivez vos encaissements et demandez des règlements en un clic.', tint: 'info' },
          { icon: Shield, title: 'Sécurité bancaire', desc: 'Authentification JWT, RBAC, RLS Supabase. Vos données et vos fonds sont protégés.', tint: 'success' },
          { icon: Smartphone, title: 'Application mobile PWA', desc: 'Installez LinkPay sur votre téléphone. Fonctionne hors-ligne, comme une app native.', tint: 'warning' },
          { icon: Zap, title: 'Paiements instantanés', desc: 'Créez une demande en 10 secondes. Le client paie, vous êtes notifié immédiatement.', tint: 'primary' },
          { icon: Wallet, title: 'Multi-devises', desc: 'Encaissez en CDF ou USD. Conversions automatiques au taux du jour.', tint: 'info' },
        ].map((f) => (
          <div key={f.title} className="rounded-2xl border border-border bg-card p-6 shadow-card hover:shadow-card-hover transition-shadow">
            <div
              className={cn(
                'w-12 h-12 rounded-2xl flex items-center justify-center mb-4',
                f.tint === 'primary' && 'bg-primary/10',
                f.tint === 'info' && 'bg-info/10',
                f.tint === 'success' && 'bg-success/10',
                f.tint === 'warning' && 'bg-warning/10',
              )}
            >
              <f.icon
                className={cn(
                  'w-6 h-6',
                  f.tint === 'primary' && 'text-primary',
                  f.tint === 'info' && 'text-info',
                  f.tint === 'success' && 'text-success',
                  f.tint === 'warning' && 'text-warning',
                )}
              />
            </div>
            <h3 className="text-lg font-bold mb-2 text-foreground">{f.title}</h3>
            <p className="text-muted-foreground text-sm">{f.desc}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-border py-8">
        <div className="container flex flex-col items-center gap-4">
          <Logo size="sm" />
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} LinkPay. Tous droits réservés.
          </p>
        </div>
      </footer>
    </div>
  );
}
