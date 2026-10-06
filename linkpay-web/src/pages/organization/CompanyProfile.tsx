import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { Loader2 } from 'lucide-react';
import { SECTORS } from './OnboardingWizard';

/**
 * Read-only view of everything the owner entered during onboarding (see
 * OnboardingWizard's 4 steps) — reachable from Settings ("Profil
 * entreprise"), not from the sidebar. Deliberately never shows
 * scanlinkpay_number/scanlinkpay_qr_url — those are payment credentials,
 * not profile information, and have no display surface in the app anymore
 * per product decision (removed from the org dashboard too).
 */
export default function CompanyProfilePage() {
  const { data: org, isLoading } = useQuery({
    queryKey: ['my-organization'],
    queryFn: async () => (await api.get('/organizations/me')).data,
  });

  if (isLoading) {
    return (
      <div className="p-6 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const address = org?.contact?.address || {};
  const sectorLabel = SECTORS.find((s) => s.value === org?.sector)?.label || org?.sector || '—';
  const addressLine = [address.avenue, address.commune, address.city, address.country].filter(Boolean).join(', ');

  const field = (label: string, value?: string | null) => (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0 gap-4">
      <span className="text-sm text-muted-foreground flex-shrink-0">{label}</span>
      <span className="text-sm font-medium text-foreground text-right">{value || '—'}</span>
    </div>
  );

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <PageHeader title="Profil entreprise" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identité légale</CardTitle>
        </CardHeader>
        <CardContent className="p-0 px-6">
          {field('Nom commercial / Enseigne', org?.name)}
          {field('Forme juridique', org?.legal_form)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Coordonnées</CardTitle>
        </CardHeader>
        <CardContent className="p-0 px-6">
          {field('Adresse', addressLine)}
          {field('Pays', address.country)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profil d'activité</CardTitle>
        </CardHeader>
        <CardContent className="p-0 px-6">
          {field('Secteur', sectorLabel)}
          {field('Description / Slogan', org?.description)}
          {field('Devise principale', org?.currency)}
          {field('Devises secondaires', (org?.secondary_currencies || []).join(', '))}
          {field('Assujetti à la TVA', org?.tax_regime === 'vat_registered' ? 'Oui' : 'Non')}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Branding</CardTitle>
        </CardHeader>
        <CardContent className="p-0 px-6">
          {field('Message de bas de reçu', org?.receipt_footer_message)}
        </CardContent>
      </Card>
    </div>
  );
}
