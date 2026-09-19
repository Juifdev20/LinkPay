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

type Step = 'legal' | 'contact' | 'activity' | 'payout' | 'representative' | 'branding';

const STEPS: { id: Step; label: string }[] = [
  { id: 'legal', label: 'Identité légale' },
  { id: 'contact', label: 'Coordonnées' },
  { id: 'activity', label: "Profil d'activité" },
  { id: 'payout', label: 'Règlement' },
  { id: 'representative', label: 'Représentant légal' },
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
const REP_ROLES = ['Directeur', 'Gérant', 'Propriétaire'];
const ID_TYPES = ["Carte d'électeur", 'Passeport', 'Permis de conduire'];

interface OnboardingFormData {
  name: string;
  legal_name: string;
  legal_form: string;
  rccm: string;
  id_nat: string;
  nif: string;

  country: string;
  city: string;
  commune: string;
  avenue: string;
  number: string;
  phone: string;
  email: string;
  website: string;

  sector: string;
  description: string;
  currency: 'CDF' | 'USD';
  secondary_currencies: ('CDF' | 'USD')[];
  vat_registered: boolean;

  mm_operator: string;
  mm_number: string;
  mm_holder_name: string;
  bank_name: string;
  bank_account_number: string;
  bank_account_holder: string;
  settlement_frequency: string;

  rep_full_name: string;
  rep_role: string;
  rep_phone: string;
  rep_email: string;
  rep_id_type: string;
  rep_id_number: string;

  receipt_footer_message: string;
}

export default function OnboardingWizard({ orgId, orgName }: { orgId: string; orgName: string }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('legal');
  const [form, setForm] = useState<OnboardingFormData>({
    name: orgName,
    legal_name: '',
    legal_form: '',
    rccm: '',
    id_nat: '',
    nif: '',

    country: 'RD Congo',
    city: '',
    commune: '',
    avenue: '',
    number: '',
    phone: '',
    email: '',
    website: '',

    sector: '',
    description: '',
    currency: 'CDF',
    secondary_currencies: [],
    vat_registered: false,

    mm_operator: '',
    mm_number: '',
    mm_holder_name: '',
    bank_name: '',
    bank_account_number: '',
    bank_account_holder: '',
    settlement_frequency: 'instant',

    rep_full_name: '',
    rep_role: '',
    rep_phone: '',
    rep_email: '',
    rep_id_type: '',
    rep_id_number: '',

    receipt_footer_message: '',
  });

  const set = <K extends keyof OnboardingFormData>(key: K, value: OnboardingFormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  const finishMutation = useMutation({
    mutationFn: async () => {
      await api.put(`/organizations/${orgId}`, {
        name: form.name,
        legal_name: form.legal_name,
        legal_form: form.legal_form,
        legal_identifiers: { rccm: form.rccm, id_nat: form.id_nat, nif: form.nif },
        contact: {
          phone: form.phone,
          email: form.email,
          website: form.website,
          address: { country: form.country, city: form.city, commune: form.commune, avenue: form.avenue, number: form.number },
        },
        sector: form.sector,
        description: form.description,
        currency: form.currency,
        secondary_currencies: form.secondary_currencies,
        tax_regime: form.vat_registered ? 'vat_registered' : 'exempt',
        payout_info: {
          mobile_money: form.mm_operator ? { operator: form.mm_operator, number: form.mm_number, holder_name: form.mm_holder_name } : null,
          bank: form.bank_name ? { name: form.bank_name, account_number: form.bank_account_number, account_holder: form.bank_account_holder } : null,
          settlement_frequency: form.settlement_frequency,
        },
        legal_representative: {
          full_name: form.rep_full_name,
          role: form.rep_role,
          phone: form.rep_phone,
          email: form.rep_email,
          id_type: form.rep_id_type,
          id_number: form.rep_id_number,
        },
        receipt_footer_message: form.receipt_footer_message,
        onboarding_completed_at: new Date().toISOString(),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-organization'] }),
  });

  const canAdvance = (): boolean => {
    if (step === 'legal') return !!form.name && !!form.legal_form;
    if (step === 'contact') return !!form.city && !!form.phone;
    if (step === 'activity') return !!form.sector;
    if (step === 'payout') return true;
    if (step === 'representative') return !!form.rep_full_name && !!form.rep_phone;
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
                <Label htmlFor="ob_legal_name">Raison sociale (si différente)</Label>
                <Input id="ob_legal_name" value={form.legal_name} onChange={(e) => set('legal_name', e.target.value)} />
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
              <div className="space-y-2">
                <Label htmlFor="ob_rccm">RCCM (optionnel)</Label>
                <Input id="ob_rccm" value={form.rccm} onChange={(e) => set('rccm', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob_id_nat">Identification Nationale (optionnel)</Label>
                <Input id="ob_id_nat" value={form.id_nat} onChange={(e) => set('id_nat', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob_nif">NIF (optionnel)</Label>
                <Input id="ob_nif" value={form.nif} onChange={(e) => set('nif', e.target.value)} />
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
              <div className="space-y-2">
                <Label htmlFor="ob_website">Site web / Réseaux sociaux (optionnel)</Label>
                <Input id="ob_website" value={form.website} onChange={(e) => set('website', e.target.value)} />
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
                Renseigne au moins un moyen de règlement pour recevoir les fonds collectés.
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
              <div className="pt-2 border-t border-border space-y-4">
                <p className="text-sm font-semibold text-foreground">Coordonnées bancaires (optionnel)</p>
                <div className="space-y-2">
                  <Label htmlFor="ob_bank_name">Banque</Label>
                  <Input id="ob_bank_name" value={form.bank_name} onChange={(e) => set('bank_name', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ob_bank_account">Numéro de compte / IBAN / RIB</Label>
                  <Input id="ob_bank_account" value={form.bank_account_number} onChange={(e) => set('bank_account_number', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ob_bank_holder">Intitulé du compte</Label>
                  <Input id="ob_bank_holder" value={form.bank_account_holder} onChange={(e) => set('bank_account_holder', e.target.value)} />
                </div>
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

          {step === 'representative' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="ob_rep_name">Nom et prénom</Label>
                <Input id="ob_rep_name" value={form.rep_full_name} onChange={(e) => set('rep_full_name', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob_rep_role">Fonction</Label>
                <Select id="ob_rep_role" value={form.rep_role} onChange={(e) => set('rep_role', e.target.value)}>
                  <option value="">Sélectionner...</option>
                  {REP_ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob_rep_phone">Téléphone</Label>
                <Input id="ob_rep_phone" placeholder="+243 8XX XXX XXX" value={form.rep_phone} onChange={(e) => set('rep_phone', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob_rep_email">Email</Label>
                <Input id="ob_rep_email" type="email" value={form.rep_email} onChange={(e) => set('rep_email', e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob_rep_id_type">Type de pièce d'identité</Label>
                <Select id="ob_rep_id_type" value={form.rep_id_type} onChange={(e) => set('rep_id_type', e.target.value)}>
                  <option value="">Sélectionner...</option>
                  {ID_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ob_rep_id_number">Numéro de la pièce</Label>
                <Input id="ob_rep_id_number" value={form.rep_id_number} onChange={(e) => set('rep_id_number', e.target.value)} />
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
