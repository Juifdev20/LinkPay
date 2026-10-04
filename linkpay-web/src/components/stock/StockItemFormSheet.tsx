import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { FormSheet } from '@/components/FormSheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { CurrencySelector } from '@/components/CurrencySelector';
import { cn } from '@/lib/utils';
import { Loader2, ImagePlus, X } from 'lucide-react';
import { STOCK_CATEGORIES } from '@/lib/stock-categories';

const CONDITIONS = [
  { value: 'neuf', label: 'Neuf' },
  { value: 'occasion', label: 'Occasion' },
  { value: 'reconditionne', label: 'Reconditionné' },
];

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export type StockItemFormValues = {
  merchant_id: string;
  category: string;
  item_type: string;
  name: string;
  brand: string;
  model: string;
  serial_number: string;
  condition: string;
  warranty_months: string;
  attributes: Record<string, string>;
  description: string;
  quantity: string;
  unit_price: string;
  currency: 'CDF' | 'USD';
  low_stock_threshold: string;
  image_url: string;
};

export const emptyStockItemForm: StockItemFormValues = {
  merchant_id: '',
  category: '',
  item_type: '',
  name: '',
  brand: '',
  model: '',
  serial_number: '',
  condition: '',
  warranty_months: '',
  attributes: {},
  description: '',
  quantity: '',
  unit_price: '',
  currency: 'CDF',
  low_stock_threshold: '5',
  image_url: '',
};

export function StockItemFormSheet({
  orgId,
  merchants,
  initial,
  itemId,
  stockPassword,
  onClose,
  onSaved,
}: {
  orgId: string;
  merchants: { id: string; name: string }[];
  /** Present → editing; absent → creating. */
  initial: StockItemFormValues;
  itemId?: string;
  /** Required when editing — already confirmed via StockPasswordDialog by the parent. */
  stockPassword?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<StockItemFormValues>(initial);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>(initial.image_url);
  const [imageError, setImageError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isEditing = !!itemId;
  const effectiveMerchantId = form.merchant_id || (merchants.length === 1 ? merchants[0].id : '');
  const category = STOCK_CATEGORIES.find((c) => c.value === form.category);

  const set = <K extends keyof StockItemFormValues>(key: K, value: StockItemFormValues[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setAttribute = (key: string, value: string) =>
    setForm((f) => ({ ...f, attributes: { ...f.attributes, [key]: value } }));

  const handlePickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImageError('');
    if (!file.type.startsWith('image/')) {
      setImageError('Le fichier doit être une image.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError("L'image ne doit pas dépasser 2 Mo.");
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      let imageUrl = form.image_url;
      if (imageFile) {
        const fd = new FormData();
        fd.append('file', imageFile);
        const { data } = await api.post(`/merchants/${effectiveMerchantId}/stock-items/image`, fd, {
          headers: { 'Content-Type': undefined },
        });
        imageUrl = data.url;
      }

      const payload = {
        name: form.name,
        category: form.category || undefined,
        item_type: form.item_type || undefined,
        attributes: form.attributes,
        description: form.description || undefined,
        brand: form.brand || undefined,
        model: form.model || undefined,
        serial_number: form.serial_number || undefined,
        condition: form.condition || undefined,
        warranty_months: form.warranty_months ? Number(form.warranty_months) : undefined,
        quantity: form.quantity ? Number(form.quantity) : 0,
        unit_price_cents: form.unit_price ? Math.round(parseFloat(form.unit_price) * 100) : 0,
        currency: form.currency,
        low_stock_threshold: form.low_stock_threshold ? Number(form.low_stock_threshold) : 5,
        image_url: imageUrl || undefined,
      };

      if (isEditing) {
        return (await api.put(`/merchants/${effectiveMerchantId}/stock-items/${itemId}`, { ...payload, stock_password: stockPassword })).data;
      }
      return (await api.post(`/merchants/${effectiveMerchantId}/stock-items`, payload)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-stock-items', orgId] });
      queryClient.invalidateQueries({ queryKey: ['org-stock-summary', orgId] });
      onSaved();
    },
  });

  return (
    <FormSheet onClose={onClose} title={isEditing ? "Modifier l'article" : 'Nouvel article'}>
      <div className="p-6 space-y-5">
        <h2 className="text-xl font-bold text-foreground">{isEditing ? "Modifier l'article" : 'Nouvel article'}</h2>

        {/* Image */}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="relative w-28 h-28 rounded-2xl border-2 border-dashed border-border hover:border-primary/50 bg-secondary/50 flex items-center justify-center overflow-hidden transition-colors"
          >
            {imagePreview ? (
              <img src={imagePreview} alt="Aperçu" className="w-full h-full object-cover" />
            ) : (
              <div className="flex flex-col items-center gap-1 text-muted-foreground">
                <ImagePlus className="w-6 h-6" />
                <span className="text-[11px] font-medium">Photo</span>
              </div>
            )}
            {imagePreview && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); setImageFile(null); setImagePreview(''); set('image_url', ''); }}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-background/90 flex items-center justify-center hover:bg-destructive/10"
              >
                <X className="w-3.5 h-3.5 text-destructive" />
              </span>
            )}
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePickImage} />
        </div>
        {imageError && <p className="text-xs text-destructive text-center -mt-3">{imageError}</p>}
        <p className="text-xs text-muted-foreground text-center -mt-3">JPEG, PNG ou WebP — 2 Mo maximum</p>

        {merchants.length > 1 && (
          <div className="space-y-2">
            <Label>Boutique</Label>
            <Select value={form.merchant_id} onChange={(e) => set('merchant_id', e.target.value)}>
              <option value="">Sélectionner...</option>
              {merchants.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </div>
        )}

        {/* Category picker */}
        <div className="space-y-2">
          <Label>Catégorie</Label>
          <div className="grid grid-cols-3 gap-2">
            {STOCK_CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => set('category', c.value)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl border-2 px-2 py-3 text-[11px] font-semibold text-center leading-tight transition-colors',
                  form.category === c.value
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-input text-muted-foreground hover:bg-accent',
                )}
              >
                <c.icon className="w-5 h-5" />
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {category && (
          <div className="space-y-2">
            <Label htmlFor="item_type">Type d'article</Label>
            <Input
              id="item_type"
              list="item-type-suggestions"
              placeholder={category.itemTypes[0]}
              value={form.item_type}
              onChange={(e) => set('item_type', e.target.value)}
            />
            <datalist id="item-type-suggestions">
              {category.itemTypes.map((t) => <option key={t} value={t} />)}
            </datalist>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="stock_name">Nom de l'article</Label>
          <Input id="stock_name" placeholder="Samsung Galaxy A54" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="stock_brand">Marque</Label>
            <Input id="stock_brand" placeholder="Samsung" value={form.brand} onChange={(e) => set('brand', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="stock_model">Modèle</Label>
            <Input id="stock_model" placeholder="Galaxy A54" value={form.model} onChange={(e) => set('model', e.target.value)} />
          </div>
        </div>

        {/* Category-specific dynamic fields */}
        {category && category.fields.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {category.fields.map((f) => (
              <div key={f.key} className="space-y-2">
                <Label htmlFor={`attr_${f.key}`}>{f.label}{f.unit ? ` (${f.unit})` : ''}</Label>
                {f.type === 'select' ? (
                  <Select id={`attr_${f.key}`} value={form.attributes[f.key] || ''} onChange={(e) => setAttribute(f.key, e.target.value)}>
                    <option value="">Sélectionner...</option>
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
          <div className="space-y-2">
            <Label htmlFor="stock_serial">N° de série / IMEI</Label>
            <Input id="stock_serial" value={form.serial_number} onChange={(e) => set('serial_number', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="stock_condition">État</Label>
            <Select id="stock_condition" value={form.condition} onChange={(e) => set('condition', e.target.value)}>
              <option value="">Sélectionner...</option>
              {CONDITIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="stock_description">Description / plus d'informations</Label>
          <Input id="stock_description" placeholder="Détails utiles pour la vente..." value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="stock_warranty">Garantie (mois)</Label>
            <Input id="stock_warranty" type="number" inputMode="numeric" value={form.warranty_months} onChange={(e) => set('warranty_months', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="stock_threshold">Seuil d'alerte</Label>
            <Input id="stock_threshold" type="number" inputMode="numeric" value={form.low_stock_threshold} onChange={(e) => set('low_stock_threshold', e.target.value)} />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="stock_quantity">{isEditing ? 'Quantité' : 'Quantité initiale'}</Label>
          <Input
            id="stock_quantity"
            type="number"
            inputMode="numeric"
            disabled={isEditing}
            value={form.quantity}
            onChange={(e) => set('quantity', e.target.value)}
          />
          {isEditing && <p className="text-xs text-muted-foreground">Utilise "Mouvement de stock" pour ajuster la quantité.</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="stock_price">Prix de vente unitaire</Label>
          <Input id="stock_price" type="number" inputMode="decimal" value={form.unit_price} onChange={(e) => set('unit_price', e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Devise</Label>
          <CurrencySelector value={form.currency} onChange={(c) => set('currency', c)} />
        </div>

        {saveMutation.isError && (
          <p className="text-sm text-destructive text-center">
            {(saveMutation.error as any)?.response?.data?.message || 'Échec de l\'enregistrement — réessaie.'}
          </p>
        )}

        <Button
          className="w-full"
          disabled={!form.name || !effectiveMerchantId || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
          {isEditing ? 'Enregistrer les modifications' : "Enregistrer l'article"}
        </Button>
      </div>
    </FormSheet>
  );
}
