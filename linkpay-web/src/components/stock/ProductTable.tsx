import { useRef, useEffect, useMemo, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { ArrowDown, ArrowUp, ArrowUpDown, Eye } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';
import { getCategoryLabel } from '@/lib/stock-categories';
import { marginOf, formatPercent } from '@/lib/margin';

type SortKey = 'name' | 'price' | 'stock';
type Sort = { key: SortKey; dir: 'asc' | 'desc' };

/** Case- and accent-insensitive ("éponge" matches "eponge"). */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function loadSort(key: string): Sort {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { key: 'name', dir: 'asc' };
}

/** Renders the barcode as an SVG using jsbarcode (CODE128, dark-mode aware). */
function BarcodeCell({ barcode }: { barcode?: string | null }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !barcode) return;
    try {
      JsBarcode(svgRef.current, barcode, {
        format: 'CODE128',
        width: 1.2,
        height: 32,
        displayValue: true,
        fontSize: 9,
        margin: 2,
        lineColor: 'currentColor',
        background: 'transparent',
      });
    } catch {
      // Invalid barcode value — leave SVG empty
    }
  }, [barcode]);

  if (!barcode) {
    return <span className="text-muted-foreground text-xs select-none">—</span>;
  }
  return <svg ref={svgRef} className="max-w-[100px] h-auto" />;
}

function StatusBadge({ quantity, threshold }: { quantity: number; threshold: number }) {
  if (quantity === 0) return <Badge variant="destructive" className="text-[11px] font-medium whitespace-nowrap">Rupture</Badge>;
  if (quantity <= threshold) return <Badge className="text-[11px] font-medium whitespace-nowrap bg-warning/15 text-warning border-warning/30 hover:bg-warning/15">Stock faible</Badge>;
  return <Badge className="text-[11px] font-medium whitespace-nowrap bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20 hover:bg-green-500/10">Disponible</Badge>;
}

/**
 * Product list table — shared by the till and the Stock page.
 *
 * Default mode (POS): compact 3-column view (Produit / Prix / Stock).
 * Stock manager mode (`stockManagerMode`): full 8-column view with barcode
 * visual, category badge, status badge, seuil and explicit actions.
 */
export function ProductTable({
  items,
  query,
  onSelect,
  cartQty,
  disableOutOfStock = false,
  showStore = false,
  sortStorageKey,
  emptyText = 'Aucun produit.',
  className = '',
  scrollClassName = '',
  stockManagerMode = false,
  showPurchase = false,
}: {
  items: any[];
  query: string;
  onSelect: (item: any) => void;
  /** Till: units of each product already in the cart (badge on the row). */
  cartQty?: Record<string, number>;
  /** Till: an out-of-stock row can't be tapped. */
  disableOutOfStock?: boolean;
  /** Org-wide stock view: show which store holds the product. */
  showStore?: boolean;
  sortStorageKey: string;
  emptyText?: string;
  className?: string;
  /** e.g. a max height on the PC till, so the list scrolls under a sticky header. */
  scrollClassName?: string;
  /**
   * When true, renders the full 8-column stock management table:
   * Code-barres | Désignation | Catégorie | Stock dispo | Seuil mini | Statut | Prix | Actions.
   * Category filtering is expected to be handled by the parent; internal
   * category select is hidden.
   */
  stockManagerMode?: boolean;
  /**
   * Stock manager mode: also the Fournisseur, Prix d'achat and Marge columns. Only for the people who may see what
   * the shop pays (never sellers or cashiers — the API leaves the purchase price out for them anyway).
   */
  showPurchase?: boolean;
}) {
  const [category, setCategory] = useState('');
  const [sort, setSortState] = useState<Sort>(() => loadSort(sortStorageKey));
  const setSort = (s: Sort) => {
    setSortState(s);
    try { localStorage.setItem(sortStorageKey, JSON.stringify(s)); } catch { /* ignore */ }
  };
  const toggleSort = (key: SortKey) =>
    setSort(sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' });

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category).filter(Boolean))].sort((a, b) => getCategoryLabel(a).localeCompare(getCategoryLabel(b))) as string[],
    [items],
  );

  const rows = useMemo(() => {
    const q = fold(query.trim());
    const filtered = items.filter((i) => {
      // Internal category filter only active in compact (POS) mode
      if (!stockManagerMode && category && i.category !== category) return false;
      if (!q) return true;
      // Brand, model and IMEI / serial only exist on electronics products.
      return [i.name, i.brand, i.model, getCategoryLabel(i.category), showPurchase ? i.supplier_name : null].some((v) => v && fold(v).includes(q))
        || (i.barcode || '').includes(q) || fold(i.serial_number || '').includes(q);
    });
    const sign = sort.dir === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sort.key === 'price') return sign * ((a.unit_price_cents ?? 0) - (b.unit_price_cents ?? 0));
      if (sort.key === 'stock') return sign * ((a.quantity ?? 0) - (b.quantity ?? 0));
      return sign * (a.name || '').localeCompare(b.name || '');
    });
  }, [items, query, category, sort, stockManagerMode, showPurchase]);

  const SortHeader = ({ k, label, align }: { k: SortKey; label: string; align: 'left' | 'right' }) => (
    <th className={`px-3 py-2.5 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${sort.key === k ? 'text-foreground' : ''}`}
      >
        {label}
        {sort.key !== k ? (
          <ArrowUpDown className="w-3 h-3 opacity-50" />
        ) : sort.dir === 'asc' ? (
          <ArrowUp className="w-3 h-3" />
        ) : (
          <ArrowDown className="w-3 h-3" />
        )}
      </button>
    </th>
  );

  // ── Stock manager mode — full 8-column table ───────────────────────────────
  if (stockManagerMode) {
    return (
      // overflow-x-auto only: horizontal scroll for wide columns on mobile,
      // but vertical scroll stays at the page level (no nested scroll bleed).
      <div className={`rounded-xl border border-border bg-card overflow-auto overscroll-contain ${className}`}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-secondary text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 font-medium text-left whitespace-nowrap">Code-barres</th>
              <SortHeader k="name" label="Désignation" align="left" />
              <th className="px-3 py-2.5 font-medium text-left">Catégorie</th>
              <SortHeader k="stock" label="Stock dispo" align="right" />
              {/* With the purchase columns, the threshold makes room (the status badge already says "low"). */}
              <th className={`px-3 py-2.5 font-medium text-right whitespace-nowrap ${showPurchase ? 'hidden 2xl:table-cell' : ''}`}>Seuil mini</th>
              <th className="px-3 py-2.5 font-medium text-left">Statut</th>
              <SortHeader k="price" label="Prix de vente" align="right" />
              {showPurchase && (
                <>
                  <th className="px-3 py-2.5 font-medium text-right whitespace-nowrap">Prix d'achat</th>
                  <th className="px-3 py-2.5 font-medium text-right">Marge</th>
                  <th className="px-3 py-2.5 font-medium text-left">Fournisseur</th>
                </>
              )}
              <th className="px-3 py-2.5 font-medium text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((item) => (
              <tr
                key={item.id}
                onClick={() => onSelect(item)}
                className="cursor-pointer transition-colors hover:bg-accent/50 active:bg-primary/10"
              >
                <td className="px-3 py-2 align-middle">
                  <BarcodeCell barcode={item.barcode} />
                </td>
                <td className="px-3 py-2 align-middle min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate max-w-[180px]">{item.name}</p>
                      {showStore && item.merchant_name && (
                        <p className="text-xs text-muted-foreground truncate">{item.merchant_name}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 align-middle whitespace-nowrap">
                  <Badge variant="outline" className="text-[11px] font-normal">
                    {getCategoryLabel(item.category)}
                  </Badge>
                </td>
                <td className="px-3 py-2 align-middle text-right font-semibold text-foreground">
                  {item.quantity ?? 0}
                </td>
                <td className={`px-3 py-2 align-middle text-right text-muted-foreground ${showPurchase ? 'hidden 2xl:table-cell' : ''}`}>
                  {item.low_stock_threshold ?? 5}
                </td>
                <td className="px-3 py-2 align-middle">
                  <StatusBadge quantity={item.quantity ?? 0} threshold={item.low_stock_threshold ?? 5} />
                </td>
                <td className="px-3 py-2 align-middle text-right font-semibold text-foreground whitespace-nowrap">
                  {formatCurrency(item.unit_price_cents, item.currency)}
                </td>
                {showPurchase && (() => {
                  const margin = marginOf(item.unit_price_cents, item.cost_price_cents);
                  return (
                    <>
                      <td className="px-3 py-2 align-middle text-right text-muted-foreground whitespace-nowrap">
                        {item.cost_price_cents != null ? formatCurrency(item.cost_price_cents, item.currency) : '—'}
                      </td>
                      <td className={`px-3 py-2 align-middle text-right whitespace-nowrap ${margin && margin.cents < 0 ? 'text-destructive' : 'text-foreground'}`}>
                        {margin ? (
                          <>
                            <span className="font-medium">{formatCurrency(margin.cents, item.currency)}</span>
                            <span className="block text-[11px] text-muted-foreground">{formatPercent(margin.percent)}</span>
                          </>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 align-middle text-muted-foreground">
                        <span className="block truncate max-w-[140px]">{item.supplier_name || '—'}</span>
                      </td>
                    </>
                  );
                })()}
                <td className="px-3 py-2 align-middle text-center">
                  <button
                    onClick={(e) => { e.stopPropagation(); onSelect(item); }}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    title="Voir le détail"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="px-3 py-6 text-sm text-muted-foreground text-center">
            {query.trim() ? `Aucun produit « ${query.trim()} »` : emptyText}
          </p>
        )}
      </div>
    );
  }

  // ── Compact mode (POS / default) — 3-column table ─────────────────────────
  return (
    <div className={`space-y-3 ${className}`}>
      {categories.length > 1 && (
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Catégorie" className="h-10">
          <option value="">Toutes les catégories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{getCategoryLabel(c)}</option>
          ))}
        </Select>
      )}

      <div className={`rounded-xl border border-border bg-card overflow-auto ${scrollClassName}`}>
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-secondary text-xs text-muted-foreground">
            <tr>
              <SortHeader k="name" label="Produit" align="left" />
              <SortHeader k="price" label="Prix" align="right" />
              <SortHeader k="stock" label="Stock" align="right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((item) => {
              const out = (item.quantity ?? 0) <= 0;
              const low = !out && item.quantity <= (item.low_stock_threshold ?? 5);
              const disabled = disableOutOfStock && out;
              const qty = cartQty?.[item.id];
              return (
                <tr
                  key={item.id}
                  onClick={() => !disabled && onSelect(item)}
                  className={`transition-colors ${disabled ? 'opacity-50' : 'cursor-pointer hover:bg-accent/50 active:bg-primary/10'} ${qty ? 'bg-primary/5' : ''}`}
                >
                  {/* w-full + max-w-0: the name column takes what is left and truncates, so price and stock stay
                      on screen on a phone. */}
                  <td className="px-3 py-2.5 w-full max-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-foreground truncate">{item.name}</span>
                      {!!qty && (
                        <span className="flex-shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center">
                          {qty}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {[[item.brand, item.model].filter(Boolean).join(' ') || (item.category && getCategoryLabel(item.category)), showStore && item.merchant_name].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-foreground whitespace-nowrap">
                    {formatCurrency(item.unit_price_cents, item.currency)}
                  </td>
                  <td className={`px-3 py-2.5 text-right whitespace-nowrap font-medium ${out ? 'text-destructive' : low ? 'text-warning' : 'text-muted-foreground'}`}>
                    {out ? 'Rupture' : item.quantity}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && (
          <p className="px-3 py-6 text-sm text-muted-foreground text-center">
            {query.trim() ? `Aucun produit « ${query.trim()} »` : emptyText}
          </p>
        )}
      </div>
    </div>
  );
}
