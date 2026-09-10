import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/lib/auth-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { User, Phone, KeyRound, ArrowLeftRight, ChevronRight, LogOut } from 'lucide-react';

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const securityLinks = [
    { to: '/dashboard/wallet/pin', label: 'Code PIN de transaction', icon: KeyRound },
    { to: '/dashboard/wallet/transactions', label: 'Mes transactions LinkPay', icon: ArrowLeftRight },
  ];

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <PageHeader title="Profil" />

      {/* Identity card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center">
              <User className="w-8 h-8 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-lg text-foreground truncate">{user?.full_name || 'Utilisateur'}</p>
              <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
              <span className="inline-block mt-1 text-xs font-semibold capitalize text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                {user?.role}
              </span>
            </div>
          </div>
          {user?.phone && (
            <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border text-sm text-muted-foreground">
              <Phone className="w-4 h-4" />
              {user.phone}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sécurité</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {securityLinks.map((link, i) => (
            <button
              key={link.to}
              onClick={() => navigate(link.to)}
              className={`flex items-center gap-3 w-full px-6 py-3.5 hover:bg-accent transition-colors text-left ${
                i !== securityLinks.length - 1 ? 'border-b border-border' : ''
              }`}
            >
              <link.icon className="w-5 h-5 text-primary" />
              <span className="flex-1 font-medium text-sm text-foreground">{link.label}</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
          ))}
        </CardContent>
      </Card>

      {/* Logout */}
      <Button
        variant="outline"
        className="w-full border-destructive/20 text-destructive hover:bg-destructive/5"
        onClick={handleLogout}
      >
        <LogOut className="w-4 h-4 mr-2" />
        Déconnexion
      </Button>
    </div>
  );
}
