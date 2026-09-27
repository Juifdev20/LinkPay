import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { CurrencySelector } from '@/components/CurrencySelector';
import { MobileMoneyOperatorPicker } from '@/components/MobileMoneyOperatorPicker';
import { Loader2, ChevronLeft } from 'lucide-react';

type Step = 'legal' | 'contact' | 'activity' | 'payout' | 'branding';

const STEPS: { id: Step; label: string }[] = [
  { id: 'legal', label: 'Identité légale' },
  { id: 'contact', label: 'Coordonnées' },
  { id: 'activity', label: "Profil d'activité" },
  { id: 'payout', label: 'Règlement' },
  { id: 'branding', label: 'Branding' },
];

const LEGAL_FORMS = ['Ets', 'SARL', 'SUARL', 'SA', 'Association/ONG', 'Autre'];
const SECTORS = [
  { value: 'boutique', label: 'Boutique' },
  { value: 'electronique', label: "Shop d'appareils électroniques" },
  { value: 'magasin', label: 'Magasin' },
  { value: 'supermarche', label: 'Supermarché' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'pharmacie', label: 'Pharmacie' },
  { value: 'service', label: 'Service / Prestation' },
  { value: 'autre', label: 'Autre' },
];
const SETTLEMENT_FREQUENCIES = [
  { value: 'instant', label: 'Instantané' },
  { value: 'daily', label: 'Quotidien' },
  { value: 'weekly', label: 'Hebdomadaire' },
];

interface OnboardingFormData {
  name: string;
  legal_form: string;

  country: string;
  city: string;
  commune: string;
  avenue: string;
  number: string;
  phone: string;
  email: string;

  sector: string;
  description: string;
  currency: 'CDF' | 'USD';
  secondary_currencies: ('CDF' | 'USD')[];
  vat_registered: boolean;

  mm_operator: string;
  mm_number: string;
  mm_holder_name: string;
  settlement_frequency: string;

  receipt_footer_message: string;
}

// `org` carries whatever was already saved — populated on a first-time
// onboarding only if register() happened to set name/contact (usually
// not), but always populated on a resubmission after rejection, so the
// owner never has to retype a rejected KYB submission from scratch.
export default function OnboardingWizard({ orgId, orgName, org }: { orgId: string; orgName: string; org?: Record<string, any> }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('legal');
  const [form, setForm] = useState<OnboardingFormData>({
    name: orgName,
    legal_form: org?.legal_form || '',

    country: org?.contact?.address?.country || 'RD Congo',
    city: org?.contact?.address?.city || '',
    commune: org?.contact?.address?.commune || '',
    avenue: org?.contact?.address?.avenue || '',
    number: org?.contact?.address?.number || '',
    phone: org?.contact?.phone || '',
    email: org?.contact?.email || '',

    sector: org?.sector || '',
    description: org?.description || '',
    currency: org?.currency || 'CDF',
    secondary_currencies: org?.secondary_currencies || [],
    vat_registered: org?.tax_regime === 'vat_registered',

    mm_operator: org?.payout_info?.mobile_money?.operator || '',
    mm_number: org?.payout_info?.mobile_money?.number || '',
    mm_holder_name: org?.payout_info?.mobile_money?.holder_name || '',
    settlement_frequency: org?.payout_info?.settlement_frequency || 'instant',

    receipt_footer_message: org?.receipt_footer_message || '',
  });

  const set = <K extends keyof OnboardingFormData>(key: K, value: OnboardingFormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  const finishMutation = useMutation({
    mutationFn: async () => {
      await api.put(`/organizations/${orgId}`, {
        name: form.name,
        legal_form: form.legal_form,
        contact: {
          phone: form.phone,
          email: form.email,
          address: { country: form.country, city: form.city, commune: form.commune, avenue: form.avenue, number: form.number },
        },
        sector: form.sector,
        description: form.description,
        currency: form.currency,
        secondary_currencies: form.secondary_currencies,
        tax_regime: form.vat_registered ? 'vat_registered' : 'exempt',
        payout_info: {
          mobile_money: form.mm_operator ? { operator: form.mm_operator, number: form.mm_number, holder_name: form.mm_holder_name } : null,
          settlement_frequency: form.settlement_frequency,
        },
        receipt_footer_message: form.receipt_footer_message,
        onboarding_completed_at: new Date().toISOString(),
      });
      // Submits for super-admin review — the org only becomes 'active' (and
      // gets its ScanLinkPay number) once an admin validates it from
      // /dashboard/admin/organizations. Also the resubmission path after a
      // rejection: this resets status to 'pending' and clears any prior
      // rejection_reason server-side.
      await api.post(`/organizations/${orgId}/submit`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-organization'] }),
  });

  const canAdvance = (): boolean => {
    if (step === 'legal') return !!form.name && !!form.legal_form;
    if (step === 'contact') return !!form.city && !!form.phone;
    if (step === 'activity') return !!form.sector;
    if (step === 'payout') return true;
    return true;
  };

  const goNext = () => {
    if (stepIndex < STEPS.length - 1) setStep(STEPS[stepIndex + 1].id);
    else finishMutation.mutate();
  };
  const goBack = () => {
    if (stepIndex > 0) setStep(STEPS[stepIndex - 1].id);
  };

  const toggleSecondaryCurrency = (c: 'CDF' | 'USD') => {
    setForm((f) => ({
      ...f,
      secondary_currencies: f.secondary_currencies.includes(c)
        ? f.secondary_currencies.filter((x) => x !== c)
        : [...f.secondary_currencies, c],
    }));
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Sticky so it stays put while only the form card below scrolls —
          top-20 on mobile clears the fixed TopBar (same offset as
          DashboardLayout's pt-20), top-0 once that bar is gone at md:.
          bg-background keeps the scrolling content from showing through. */}
      <div className="sticky top-20 md:top-0 z-10 bg-background px-6 pt-6 pb-4">
        <h1 className="text-2xl font-bold text-foreground">Configuration de l'entreprise</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Étape {stepIndex + 1} sur {STEPS.length} — {STEPS[stepIndex].label}
        </p>
        <div className="mt-3 h-1.5 w-full rounded-full bg-accent overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="px-6 pb-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{STEPS[stepIndex].label}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 'legal' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="ob_name">Nom commercial / Enseigne</Label>
                <Input id="ob_name" value={form.name} onChange={(e) => set('name', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob_legal_form">Forme juridique</Label>
                <Select id="ob_legal_form" value={form.legal_form} onChange={(e) => set('legal_form', e.target.value)}>
                  <option value="">Sélectionner...</option>
                  {LEGAL_FORMS.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </Select>
              </div>
            </>
          )}

          {step === 'contact' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="ob_country">Pays</Label>
                  <Input id="ob_country" value={form.country} onChange={(e) => set('country', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ob_city">Ville</Label>
                  <Input id="ob_city" placeholder="Kinshasa" value={form.city} onChange={(e) => set('city', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="ob_commune">Commune</Label>
                  <Input id="ob_commune" value={form.commune} onChange={(e) => set('commune', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ob_avenue">Avenue / Numéro</Label>
                  <Input id="ob_avenue" value={form.avenue} onChange={(e) => set('avenue', e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob_phone">Téléphone professionnel / WhatsApp</Label>
                <Input id="ob_phone" placeholder="+243 8XX XXX XXX" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob_email">Email professionnel</Label>
                <Input id="ob_email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
              </div>
            </>
          )}

          {step === 'activity' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="ob_sector">Secteur d'activité</Label>
                <Select id="ob_sector" value={form.sector} onChange={(e) => set('sector', e.target.value)}>
                  <option value="">Sélectionner...</option>
                  {SECTORS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob_description">Description courte / Slogan</Label>
                <Input id="ob_description" value={form.description} onChange={(e) => set('description', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Devise principale</Label>
                <CurrencySelector value={form.currency} onChange={(c) => set('currency', c)} />
              </div>
              <div className="space-y-2">
                <Label>Devises secondaires acceptées</Label>
                <div className="flex gap-2">
                  {(['CDF', 'USD'] as const).filter((c) => c !== form.currency).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => toggleSecondaryCurrency(c)}
                      className={`rounded-xl border-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                        form.secondary_currencies.includes(c)
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-input text-muted-foreground hover:bg-accent'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border p-4">
                <div>
                  <p className="font-semibold text-foreground text-sm">Assujetti à la TVA</p>
                  <p className="text-xs text-muted-foreground">Pour le calcul automatique sur les factures</p>
                </div>
                <Switch checked={form.vat_registered} onCheckedChange={(v) => set('vat_registered', v)} />
              </div>
            </>
          )}

          {step === 'payout' && (
            <>
              <p className="text-sm text-muted-foreground">
                Renseigne ton moyen de règlement Mobile Money pour recevoir les fonds collectés.
              </p>
              <MobileMoneyOperatorPicker value={form.mm_operator} onChange={(v) => set('mm_operator', v)} />
              <div className="space-y-2">
                <Label htmlFor="ob_mm_number">Numéro Mobile Money</Label>
                <Input id="ob_mm_number" placeholder="+243 8XX XXX XXX" value={form.mm_number} onChange={(e) => set('mm_number', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob_mm_holder">Nom du titulaire</Label>
                <Input id="ob_mm_holder" value={form.mm_holder_name} onChange={(e) => set('mm_holder_name', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob_settlement_freq">Fréquence de règlement</Label>
                <Select id="ob_settlement_freq" value={form.settlement_frequency} onChange={(e) => set('settlement_frequency', e.target.value)}>
                  {SETTLEMENT_FREQUENCIES.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </Select>
              </div>
            </>
          )}

          {step === 'branding' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="ob_receipt_footer">Message personnalisé de bas de reçu</Label>
                <Input
                  id="ob_receipt_footer"
                  placeholder="Merci pour votre visite !"
                  value={form.receipt_footer_message}
                  onChange={(e) => set('receipt_footer_message', e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                L'ajout d'un logo sera disponible prochainement.
              </p>
            </>
          )}

          {finishMutation.isError && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive font-medium">
              Échec de l'enregistrement — réessaie.
            </div>
          )}

          <div className="flex gap-3 pt-2">
            {stepIndex > 0 && (
              <Button type="button" variant="outline" onClick={goBack} disabled={finishMutation.isPending}>
                <ChevronLeft className="mr-1 w-4 h-4" />
                Précédent
              </Button>
            )}
            <Button type="button" className="flex-1" disabled={!canAdvance() || finishMutation.isPending} onClick={goNext}>
              {finishMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
              {stepIndex < STEPS.length - 1 ? 'Suivant' : 'Terminer'}
            </Button>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
