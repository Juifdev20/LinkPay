import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { FormSheet } from '@/components/FormSheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Loader2, ScanBarcode, Printer, ChevronDown } from 'lucide-react';
import { getSectorConfig } from '@/lib/stock-categories';
import { BarcodeScannerView } from '@/components/BarcodeScannerView';
import { beepOk, generateInStoreEan13, isInStoreEan13 } from '@/lib/barcode';
import { ProductLabelSheet, clampLabels, MAX_LABELS } from './ProductLabelSheet';

const CONDITIONS = [
  { value: 'neuf', label: 'Neuf' },
  { value: 'occasion', label: 'Occasion' },
  { value: 'reconditionne', label: 'Reconditionné' },
];

/** Category select value meaning "type my own". */
const OTHER = '__autre__';

export type StockItemFormValues = {
  merchant_id: string;
  category: string;
  item_type: string;
  name: string;
  brand: string;
  model: string;
  serial_number: string;
  barcode: string;
  condition: string;
  warranty_months: string;
  attributes: Record<string, string>;
  description: string;
  quantity: string;
  unit_price: string;
  currency: 'CDF' | 'USD';
  low_stock_threshold: string;
};

export const emptyStockItemForm: StockItemFormValues = {
  merchant_id: '',
  category: '',
  item_type: '',
  name: '',
  brand: '',
  model: '',
  serial_number: '',
  barcode: '',
  condition: '',
  warranty_months: '',
  attributes: {},
  description: '',
  quantity: '',
  unit_price: '',
  currency: 'CDF',
  low_stock_threshold: '5',
};

/**
 * Product sheet — built to register a product in under a minute: the
 * essentials first (name, barcode, category, price, quantity), everything
 * optional folded under "Plus de détails". What it asks depends on the
 * organization's sector (getSectorConfig): a supermarket never sees the
 * electronics fields (brand, model, IMEI…). No product photo — it weighed
 * on the form, the screens and the storage for no sales value.
 */
export function StockItemFormSheet({
  orgId,
  sector,
  merchants,
  initial,
  itemId,
  onClose,
  onSaved,
}: {
  orgId: string;
  /** organizations.sector — decides categories and fields. */
  sector?: string | null;
  merchants: { id: string; name: string }[];
  /** Present → editing; absent → creating. */
  initial: StockItemFormValues;
  itemId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const config = getSectorConfig(sector);
  const [form, setForm] = useState<StockItemFormValues>(initial);
  const [scanning, setScanning] = useState(false);
  // Label printed right after a successful save (see labelOnSave).
  const [savedLabel, setSavedLabel] = useState<{ product: any; copies: number; stockQuantity: number } | null>(null);
  // How many labels to print. Follows the quantity typed (120 bags → 120
  // labels) until the user types their own number — they decide in the end.
  const [labelCopies, setLabelCopies] = useState('1');
  const [labelCopiesTouched, setLabelCopiesTouched] = useState(false);

  const isEditing = !!itemId;
  const effectiveMerchantId = form.merchant_id || (merchants.length === 1 ? merchants[0].id : '');
  const category = config.categories.find((c) => c.value === form.category);

  // Optional fields start folded — opened when editing a product that has any.
  const hasDetails = !!(
    initial.description || initial.brand || initial.model || initial.serial_number ||
    initial.condition || initial.warranty_months || initial.item_type ||
    Object.values(initial.attributes || {}).some(Boolean)
  );
  const [detailsOpen, setDetailsOpen] = useState(isEditing && hasDetails);

  // A category not in the sector list (older product, typed by hand) stays
  // selectable; "Autre…" switches to a free-text field.
  const knownCategory = !form.category || config.categories.some((c) => c.value === form.category);
  const [customCategory, setCustomCategory] = useState(!knownCategory);

  const set = <K extends keyof StockItemFormValues>(key: K, value: StockItemFormValues[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setAttribute = (key: string, value: string) =>
    setForm((f) => ({ ...f, attributes: { ...f.attributes, [key]: value } }));

  // A label is printed only for a code generated here (in-store EAN —
  // manufacturer codes are already on the packaging), and only once the
  // product is complete: the save button then saves AND prints, so a label
  // never comes out for a product without a price or not yet saved.
  const priceCents = form.unit_price ? Math.round(parseFloat(form.unit_price) * 100) : 0;
  const needsLabel = isInStoreEan13(form.barcode) && form.barcode !== initial.barcode;
  const labelOnSave = needsLabel && !!form.name && priceCents > 0;
  const qtyNumber = Math.max(0, Math.floor(Number(form.quantity) || 0));
  const labelCount = labelCopiesTouched ? clampLabels(labelCopies) : clampLabels(qtyNumber || 1);
  const labelInputValue = labelCopiesTouched ? labelCopies : String(labelCount);
  const setLabelCount = (v: string) => {
    setLabelCopiesTouched(true);
    setLabelCopies(v);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const technical = config.technicalFields;
      const payload = {
        name: form.name.trim(),
        category: form.category.trim() || undefined,
        description: form.description || undefined,
        // Sent even when empty while editing: clearing the field removes the code.
        barcode: isEditing ? form.barcode.trim() : form.barcode.trim() || undefined,
        // Editing: an empty field means "leave the stock as it is", never 0.
        quantity: isEditing
          ? (form.quantity === '' ? undefined : Number(form.quantity))
          : (form.quantity ? Number(form.quantity) : 0),
        unit_price_cents: priceCents,
        currency: form.currency,
        low_stock_threshold: form.low_stock_threshold ? Number(form.low_stock_threshold) : 5,
        // Electronics-only fields — never sent for other sectors.
        ...(technical && {
          item_type: form.item_type || undefined,
          attributes: form.attributes,
          brand: form.brand || undefined,
          model: form.model || undefined,
          serial_number: form.serial_number || undefined,
          condition: form.condition || undefined,
          warranty_months: form.warranty_months ? Number(form.warranty_months) : undefined,
        }),
      };

      if (isEditing) {
        return (await api.put(`/merchants/${effectiveMerchantId}/stock-items/${itemId}`, payload)).data;
      }
      return (await api.post(`/merchants/${effectiveMerchantId}/stock-items`, payload)).data;
    },
    onSuccess: (saved: any) => {
      queryClient.invalidateQueries({ queryKey: ['org-stock-items', orgId] });
      queryClient.invalidateQueries({ queryKey: ['org-stock-summary', orgId] });
      // The till's catalog must show the new/changed product right away.
      queryClient.invalidateQueries({ queryKey: ['pos-catalog'] });
      if (labelOnSave) {
        // Print from what the server actually saved — never from a draft.
        setSavedLabel({
          product: {
            name: saved?.name ?? form.name,
            barcode: saved?.barcode ?? form.barcode,
            unit_price_cents: saved?.unit_price_cents ?? priceCents,
            currency: saved?.currency ?? form.currency,
          },
          copies: labelCount,
          stockQuantity: saved?.quantity ?? qtyNumber,
        });
        return;
      }
      onSaved();
    },
  });

  const canSave = !!form.name.trim() && !!effectiveMerchantId && priceCents > 0 && !saveMutation.isPending;

  return (
    <FormSheet onClose={onClose} title={isEditing ? "Modifier l'article" : 'Nouvel article'}>
      <div className="p-6 space-y-4">
        <h2 className="text-xl font-bold text-foreground">{isEditing ? "Modifier l'article" : 'Nouvel article'}</h2>

        {merchants.length > 1 && (
          <div className="space-y-1.5">
            <Label>Boutique</Label>
            <Select value={form.merchant_id} onChange={(e) => set('merchant_id', e.target.value)}>
              <option value="">Sélectionner…</option>
              {merchants.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="stock_name">Nom de l'article</Label>
          <Input id="stock_name" placeholder={config.namePlaceholder} value={form.name} onChange={(e) => set('name', e.target.value)} />
        </div>

        {/* Barcode — what the till scans. Manufacturer code when the
            packaging has one, else an in-store code printed on a label. */}
        <div className="space-y-1.5">
          <Label htmlFor="stock_barcode">Code-barres</Label>
          <div className="flex gap-2">
            <Input
              id="stock_barcode"
              inputMode="numeric"
              placeholder="Scannez ou saisissez"
              value={form.barcode}
              onChange={(e) => set('barcode', e.target.value.trim())}
              // A hand-held scanner types the code then Enter — don't let
              // that Enter do anything else in the form.
              onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
              className="flex-1 min-w-0 font-mono"
            />
            <Button type="button" variant="outline" size="icon" className="h-12 w-12 flex-shrink-0" onClick={() => setScanning(true)} title="Scanner avec la caméra">
              <ScanBarcode className="w-4 h-4" />
            </Button>
            <Button type="button" variant="outline" className="h-12 flex-shrink-0" onClick={() => set('barcode', generateInStoreEan13())} title="Générer un code pour ce produit">
              Générer
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {needsLabel
              ? labelOnSave
                ? "L'étiquette sera imprimée à l'enregistrement."
                : "L'étiquette sera imprimée à l'enregistrement, une fois le nom et le prix renseignés."
              : 'Produit emballé : scannez son code. Sans code : « Générer », une étiquette sera imprimée.'}
          </p>
        </div>

        {needsLabel && (
          <div className="space-y-1.5 rounded-xl border border-primary/20 bg-primary/5 p-3">
            <Label htmlFor="label_copies">Nombre d'étiquettes à imprimer</Label>
            <Input
              id="label_copies"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_LABELS}
              value={labelInputValue}
              onChange={(e) => setLabelCount(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              {qtyNumber > 1 && (
                <button type="button" onClick={() => { setLabelCopiesTouched(false); }} className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground hover:bg-accent">
                  = quantité ({Math.min(qtyNumber, MAX_LABELS)})
                </button>
              )}
              <button type="button" onClick={() => setLabelCount('1')} className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground hover:bg-accent">
                1 seule
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {labelCopiesTouched ? 'Nombre choisi par vous.' : 'Suit la quantité saisie — modifiez-le si besoin.'}
              {labelCount > 100 && " Vérifiez qu'il y a assez de papier dans l'imprimante."}
              {qtyNumber > MAX_LABELS && ` Maximum ${MAX_LABELS} par impression — relancez depuis la fiche produit pour le reste.`}
            </p>
          </div>
        )}

        {/* Category — one compact bar instead of a grid of cards */}
        <div className="space-y-1.5">
          <Label htmlFor="stock_category">Catégorie</Label>
          <Select
            id="stock_category"
            value={customCategory ? OTHER : form.category}
            onChange={(e) => {
              if (e.target.value === OTHER) {
                setCustomCategory(true);
                set('category', '');
              } else {
                setCustomCategory(false);
                set('category', e.target.value);
              }
            }}
          >
            <option value="">Choisir une catégorie…</option>
            {config.categories.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
            <option value={OTHER}>Nouvelle catégorie…</option>
          </Select>
          {customCategory && (
            <Input
              placeholder="Nom de la catégorie"
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              autoFocus
            />
          )}
        </div>

        <div className="grid grid-cols-[1fr_110px] gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="stock_price">Prix de vente</Label>
            <Input id="stock_price" type="number" inputMode="decimal" min={0} placeholder="0" value={form.unit_price} onChange={(e) => set('unit_price', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stock_currency">Devise</Label>
            <Select id="stock_currency" value={form.currency} onChange={(e) => set('currency', e.target.value as 'CDF' | 'USD')}>
              <option value="CDF">CDF</option>
              <option value="USD">USD</option>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="stock_quantity">{isEditing ? 'Quantité' : 'Quantité initiale'}</Label>
            <Input id="stock_quantity" type="number" inputMode="numeric" min={0} placeholder="0" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="stock_threshold">Alerte stock bas</Label>
            <Input id="stock_threshold" type="number" inputMode="numeric" min={0} value={form.low_stock_threshold} onChange={(e) => set('low_stock_threshold', e.target.value)} />
          </div>
        </div>
        {isEditing && (
          <p className="text-xs text-muted-foreground -mt-2">Changer la quantité ajuste le stock (enregistré dans l'historique des mouvements).</p>
        )}

        {/* Optional — folded so the essential sheet stays short */}
        <div className="rounded-xl border border-border">
          <button
            type="button"
            onClick={() => setDetailsOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground"
          >
            Plus de détails{" "}<span className="text-muted-foreground font-normal">(facultatif)</span>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ml-auto ${detailsOpen ? 'rotate-180' : ''}`} />
          </button>
          {detailsOpen && (
            <div className="px-4 pb-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="stock_description">Description</Label>
                <Input id="stock_description" placeholder="Détails utiles pour la vente…" value={form.description} onChange={(e) => set('description', e.target.value)} />
              </div>

              {config.technicalFields && (
                <>
                  {category && category.itemTypes.length > 0 && (
                    <div className="space-y-1.5">
                      <Label htmlFor="item_type">Type d'article</Label>
                      <Input id="item_type" list="item-type-suggestions" placeholder={category.itemTypes[0]} value={form.item_type} onChange={(e) => set('item_type', e.target.value)} />
                      <datalist id="item-type-suggestions">
                        {category.itemTypes.map((t) => <option key={t} value={t} />)}
                      </datalist>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="stock_brand">Marque</Label>
                      <Input id="stock_brand" placeholder="Samsung" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="stock_model">Modèle</Label>
                      <Input id="stock_model" placeholder="Galaxy A54" value={form.model} onChange={(e) => set('model', e.target.value)} />
                    </div>
                  </div>
                  {category && category.fields.length > 0 && (
                    <div className="grid grid-cols-2 gap-3">
                      {category.fields.map((f) => (
                        <div key={f.key} className="space-y-1.5">
                          <Label htmlFor={`attr_${f.key}`}>{f.label}{f.unit ? ` (${f.unit})` : ''}</Label>
                          {f.type === 'select' ? (
                            <Select id={`attr_${f.key}`} value={form.attributes[f.key] || ''} onChange={(e) => setAttribute(f.key, e.target.value)}>
                              <option value="">Sélectionner…</option>
                              {f.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                            </Select>
                          ) : (
                            <Input
                              id={`attr_${f.key}`}
                              type={f.type === 'number' ? 'number' : 'text'}
                              inputMode={f.type === 'number' ? 'decimal' : undefined}
                              placeholder={f.placeholder}
                              value={form.attributes[f.key] || ''}
                              onChange={(e) => setAttribute(f.key, e.target.value)}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="stock_serial">N° de série / IMEI</Label>
                      <Input id="stock_serial" value={form.serial_number} onChange={(e) => set('serial_number', e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="stock_condition">État</Label>
                      <Select id="stock_condition" value={form.condition} onChange={(e) => set('condition', e.target.value)}>
                        <option value="">Sélectionner…</option>
                        {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="stock_warranty">Garantie (mois)</Label>
                    <Input id="stock_warranty" type="number" inputMode="numeric" value={form.warranty_months} onChange={(e) => set('warranty_months', e.target.value)} />
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {saveMutation.isError && (
          <p className="text-sm text-destructive text-center">
            {(saveMutation.error as any)?.response?.data?.message || "Échec de l'enregistrement — réessayez."}
          </p>
        )}
        {!priceCents && form.name.trim() && (
          <p className="text-xs text-muted-foreground text-center">Indiquez le prix de vente pour enregistrer.</p>
        )}

        <Button className="w-full" size="lg" disabled={!canSave} onClick={() => saveMutation.mutate()}>
          {saveMutation.isPending
            ? <Loader2 className="mr-2 w-4 h-4 animate-spin" />
            : labelOnSave && <Printer className="mr-2 w-4 h-4" />}
          {labelOnSave
            ? `Enregistrer et imprimer ${labelCount > 1 ? `${labelCount} étiquettes` : "l'étiquette"}`
            : isEditing ? 'Enregistrer les modifications' : "Enregistrer l'article"}
        </Button>
      </div>

      {scanning && (
        <BarcodeScannerView
          title="Scanner le code du produit"
          onDetected={(code) => { beepOk(); set('barcode', code); }}
          onClose={() => setScanning(false)}
        />
      )}

      {/* Saved — the label prints straight away; closing it ends the flow. */}
      {savedLabel && (
        <ProductLabelSheet product={savedLabel.product} autoPrintCopies={savedLabel.copies} stockQuantity={savedLabel.stockQuantity} onClose={onSaved} />
      )}
    </FormSheet>
  );
}
