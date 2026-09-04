import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/auth-store';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/Logo';
import { PageHeader } from '@/components/PageHeader';
import { Wallet, ShieldCheck, Users, UserCog, Percent, Building2, UsersRound, Receipt, LogOut, User, HelpCircle, FileText, ChevronRight, Store, Loader2, KeyRound, ArrowLeftRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const applyMerchantUpgrade = useAuthStore((s) => s.applyMerchantUpgrade);
  const applyEnterpriseUpgrade = useAuthStore((s) => s.applyEnterpriseUpgrade);
  const navigate = useNavigate();
  const [showUpgradeForm, setShowUpgradeForm] = useState(false);
  const [showOrgForm, setShowOrgForm] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [store, setStore] = useState({ name: '', phone: '', city: '' });
  const [orgForm, setOrgForm] = useState({ name: '', legal_name: '' });
  const [upgradeError, setUpgradeError] = useState('');
  const [orgError, setOrgError] = useState('');

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const upgradeMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/merchants', store);
      return data;
    },
    onSuccess: (data) => {
      applyMerchantUpgrade(data.merchant, data.access_token);
      navigate('/dashboard');
    },
    onError: (err: any) => {
      setUpgradeError(err.response?.data?.message || "Échec de la création de la boutique");
    },
  });

  const orgMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/organizations', orgForm);
      return data;
    },
    onSuccess: (data) => {
      applyEnterpriseUpgrade(data.access_token);
      navigate('/dashboard/organization');
    },
    onError: (err: any) => {
      setOrgError(err.response?.data?.message || "Échec de la création de l'organisation");
    },
  });

  const walletRoles = ['merchant', 'cashier', 'enterprise', 'client'];

  const secondaryLinks = [
    { to: '/dashboard/wallet/transactions', label: 'Mes transactions LinkPay', icon: ArrowLeftRight, roles: walletRoles },
    { to: '/dashboard/wallet/pin', label: 'Code PIN de transaction', icon: KeyRound, roles: walletRoles },
    { to: '/dashboard/settlements', label: 'Règlements', icon: Wallet, roles: ['merchant', 'enterprise'] },
    { to: '/dashboard/payment-requests', label: 'Demandes de paiement', icon: ShieldCheck, roles: ['merchant', 'cashier', 'enterprise'] },
    { to: '/dashboard/team', label: 'Équipe', icon: UsersRound, roles: ['merchant'] },
    { to: '/dashboard/client/transactions', label: 'Mes paiements', icon: Receipt, roles: ['merchant', 'cashier', 'enterprise', 'client', 'admin', 'super_admin'] },
    { to: '/dashboard/organization', label: 'Mon organisation', icon: Building2, roles: ['enterprise'] },
    { to: '/dashboard/admin', label: 'Administration', icon: ShieldCheck, roles: ['admin', 'super_admin'] },
    { to: '/dashboard/admin/merchants', label: 'Commerçants', icon: Users, roles: ['admin', 'super_admin'] },
    { to: '/dashboard/admin/settlements', label: 'Règlements (admin)', icon: Wallet, roles: ['admin', 'super_admin'] },
    { to: '/dashboard/admin/users', label: 'Utilisateurs', icon: UserCog, roles: ['super_admin'] },
    { to: '/dashboard/admin/commissions', label: 'Commissions', icon: Percent, roles: ['super_admin'] },
  ];

  const visibleSecondary = secondaryLinks.filter((l) => !user || l.roles.includes(user.role));

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <PageHeader title="Paramètres" />

      {/* Profile card */}
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
        </CardContent>
      </Card>

      {/* Become a merchant */}
      {user?.role === 'client' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Store className="w-4 h-4 text-primary" />
              Devenir marchand
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!showUpgradeForm ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Créez votre boutique pour recevoir des paiements via lien et QR code.
                </p>
                <Button className="w-full" onClick={() => setShowUpgradeForm(true)}>
                  Créer ma boutique
                </Button>
              </>
            ) : (
              <>
                {upgradeError && (
                  <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">
                    {upgradeError}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="store_name">Nom de la boutique</Label>
                  <Input
                    id="store_name"
                    placeholder="Boutique Mukendi"
                    value={store.name}
                    onChange={(e) => setStore({ ...store, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="store_phone">Téléphone</Label>
                  <Input
                    id="store_phone"
                    placeholder="+243 8XX XXX XXX"
                    value={store.phone}
                    onChange={(e) => setStore({ ...store, phone: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="store_city">Ville</Label>
                  <Input
                    id="store_city"
                    placeholder="Kinshasa"
                    value={store.city}
                    onChange={(e) => setStore({ ...store, city: e.target.value })}
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={!store.name || upgradeMutation.isPending}
                  onClick={() => upgradeMutation.mutate()}
                >
                  {upgradeMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                  Confirmer
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create an organization */}
      {user?.role === 'client' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" />
              Créer mon organisation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!showOrgForm ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Pour une entreprise qui gère plusieurs comptes. La gestion multi-boutiques n'est pas encore disponible.
                </p>
                <Button variant="outline" className="w-full" onClick={() => setShowOrgForm(true)}>
                  Créer mon organisation
                </Button>
              </>
            ) : (
              <>
                {orgError && (
                  <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">
                    {orgError}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="org_name_settings">Nom de l'organisation</Label>
                  <Input
                    id="org_name_settings"
                    placeholder="Tech Solutions SARL"
                    value={orgForm.name}
                    onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org_legal_name_settings">Raison sociale (optionnel)</Label>
                  <Input
                    id="org_legal_name_settings"
                    value={orgForm.legal_name}
                    onChange={(e) => setOrgForm({ ...orgForm, legal_name: e.target.value })}
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={!orgForm.name || orgMutation.isPending}
                  onClick={() => orgMutation.mutate()}
                >
                  {orgMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                  Confirmer
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Secondary navigation */}
      {visibleSecondary.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gestion</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {visibleSecondary.map((link, i) => (
              <button
                key={link.to}
                onClick={() => navigate(link.to)}
                className={cn(
                  'flex items-center gap-3 w-full px-6 py-3.5 hover:bg-accent transition-colors text-left',
                  i !== visibleSecondary.length - 1 && 'border-b border-border',
                )}
              >
                <link.icon className="w-5 h-5 text-primary" />
                <span className="flex-1 font-medium text-sm text-foreground">{link.label}</span>
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* General settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Général</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="flex items-center gap-3 w-full px-6 py-3.5 hover:bg-accent transition-colors text-left border-b border-border"
          >
            <HelpCircle className="w-5 h-5 text-muted-foreground" />
            <span className="flex-1 font-medium text-sm text-foreground">Aide & support</span>
            <ChevronRight className={cn('w-4 h-4 text-muted-foreground transition-transform', showHelp && 'rotate-90')} />
          </button>
          {showHelp && (
            <p className="px-6 py-3.5 text-sm text-muted-foreground border-b border-border bg-secondary/50">
              Besoin d'aide ? Contactez-nous à support@linkpay.cd ou au +243 800 000 000.
            </p>
          )}
          <button
            onClick={() => setShowTerms(!showTerms)}
            className="flex items-center gap-3 w-full px-6 py-3.5 hover:bg-accent transition-colors text-left"
          >
            <FileText className="w-5 h-5 text-muted-foreground" />
            <span className="flex-1 font-medium text-sm text-foreground">Conditions générales</span>
            <ChevronRight className={cn('w-4 h-4 text-muted-foreground transition-transform', showTerms && 'rotate-90')} />
          </button>
          {showTerms && (
            <p className="px-6 py-3.5 text-sm text-muted-foreground bg-secondary/50">
              En utilisant LinkPay, vous acceptez nos conditions d'utilisation et notre politique de confidentialité.
            </p>
          )}
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

      {/* Footer logo */}
      <div className="flex justify-center pt-4">
        <Logo size="sm" />
      </div>
    </div>
  );
}
