import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';
import { Loader2, Pencil, Trash2, Boxes } from 'lucide-react';
import { getCategoryLabel, getCategoryIcon, STOCK_CATEGORIES } from '@/lib/stock-categories';

const CONDITIONS: Record<string, string> = { neuf: 'Neuf', occasion: 'Occasion', reconditionne: 'Reconditionné' };
const MOVEMENT_TYPES = [
  { value: 'in', label: 'Réapprovisionnement (+)' },
  { value: 'out', label: 'Perte / casse (-)' },
  { value: 'adjustment', label: 'Correction' },
];

const ATTRIBUTE_LABELS: Record<string, string> = Object.fromEntries(
  STOCK_CATEGORIES.flatMap((c) => c.fields.map((f) => [f.key, f.label + (f.unit ? ` (${f.unit})` : '')])),
);

export function StockItemDetailDialog({
  item,
  orgId,
  onClose,
  onEdit,
  onDelete,
}: {
  item: any;
  orgId: string;
  onClose: () => void;
  onEdit: (item: any) => void;
  onDelete: (item: any) => void;
}) {
  const queryClient = useQueryClient();
  const [showMovement, setShowMovement] = useState(false);
  const [movement, setMovement] = useState({ type: 'in', quantity: '', reason: '' });

  const movementMutation = useMutation({
    mutationFn: async () => {
      const qty = Math.abs(Number(movement.quantity) || 0);
      const quantity_delta = movement.type === 'out' ? -qty : movement.type === 'in' ? qty : (Number(movement.quantity) || 0);
      return (await api.post(`/merchants/${item.merchant_id}/stock-items/${item.id}/movements`, {
        type: movement.type,
        quantity_delta,
        reason: movement.reason || undefined,
      })).data;
    },
    onSuccess: () => {
      setShowMovement(false);
      setMovement({ type: 'in', quantity: '', reason: '' });
      queryClient.invalidateQueries({ queryKey: ['org-stock-items', orgId] });
      queryClient.invalidateQueries({ queryKey: ['org-stock-summary', orgId] });
      onClose();
    },
  });

  const CategoryIcon = getCategoryIcon(item.category);
  const attributeEntries = Object.entries(item.attributes || {}).filter(([, v]) => v !== '' && v != null);
  const lowStock = item.quantity <= item.low_stock_threshold;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="sr-only">{item.name}</DialogTitle>
        </DialogHeader>

        <div className="flex justify-center mb-4">
          {item.image_url ? (
            <img src={item.image_url} alt={item.name} className="w-40 h-40 rounded-2xl object-cover border border-border" />
          ) : (
            <div className="w-40 h-40 rounded-2xl bg-secondary flex items-center justify-center">
              <CategoryIcon className="w-14 h-14 text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="text-center mb-4">
          <h2 className="text-xl font-bold text-foreground">{item.name}</h2>
          <p className="text-sm text-muted-foreground">{[item.brand, item.model].filter(Boolean).join(' ') || '—'}</p>
          <div className="flex items-center justify-center gap-1.5 flex-wrap mt-2">
            {item.category && <Badge variant="secondary">{getCategoryLabel(item.category)}</Badge>}
            {item.item_type && <Badge variant="secondary">{item.item_type}</Badge>}
            {item.condition && <Badge variant="secondary">{CONDITIONS[item.condition] || item.condition}</Badge>}
            {lowStock && <Badge variant="error">Stock bas</Badge>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-xl border border-border p-3 text-center">
            <p className="text-lg font-bold text-foreground">{item.quantity}</p>
            <p className="text-xs text-muted-foreground">En stock{item.merchant_name ? ` · ${item.merchant_name}` : ''}</p>
          </div>
          <div className="rounded-xl border border-border p-3 text-center">
            <p className="text-lg font-bold text-foreground">{formatCurrency(item.unit_price_cents, item.currency)}</p>
            <p className="text-xs text-muted-foreground">Prix de vente</p>
          </div>
        </div>

        {(attributeEntries.length > 0 || item.serial_number || item.warranty_months || item.description) && (
          <div className="space-y-1 text-sm rounded-xl border border-border p-4 mb-4">
            {attributeEntries.map(([key, value]) => (
              <p key={key}><span className="text-muted-foreground">{ATTRIBUTE_LABELS[key] || key} : </span>{String(value)}</p>
            ))}
            {item.serial_number && <p><span className="text-muted-foreground">N° de série / IMEI : </span>{item.serial_number}</p>}
            {item.warranty_months != null && <p><span className="text-muted-foreground">Garantie : </span>{item.warranty_months} mois</p>}
            {item.description && <p><span className="text-muted-foreground">Description : </span>{item.description}</p>}
          </div>
        )}

        {showMovement ? (
          <div className="rounded-xl border border-border p-3 space-y-2 mb-4">
            <Select value={movement.type} onChange={(e) => setMovement({ ...movement, type: e.target.value })}>
              {MOVEMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>
            <Input
              type="number"
              placeholder="Quantité"
              value={movement.quantity}
              onChange={(e) => setMovement({ ...movement, quantity: e.target.value })}
            />
            <Input
              placeholder="Motif (optionnel)"
              value={movement.reason}
              onChange={(e) => setMovement({ ...movement, reason: e.target.value })}
            />
            {movementMutation.isError && (
              <p className="text-xs text-destructive">{(movementMutation.error as any)?.response?.data?.message || 'Échec — réessaie.'}</p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowMovement(false)}>Annuler</Button>
              <Button
                size="sm"
                className="flex-1"
                disabled={!movement.quantity || movementMutation.isPending}
                onClick={() => movementMutation.mutate()}
              >
                {movementMutation.isPending && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
                Confirmer
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" className="w-full mb-4" onClick={() => setShowMovement(true)}>
            <Boxes className="mr-2 w-4 h-4" />
            Mouvement de stock
          </Button>
        )}

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onEdit(item)}>
            <Pencil className="mr-2 w-4 h-4" />
            Modifier
          </Button>
          <Button variant="outline" className="flex-1 text-destructive hover:text-destructive" onClick={() => onDelete(item)}>
            <Trash2 className="mr-2 w-4 h-4" />
            Supprimer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
