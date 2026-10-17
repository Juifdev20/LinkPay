import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { formatCurrency } from '@/lib/utils';
import { getCategoryLabel } from '@/lib/stock-categories';

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

/**
 * Product list as a compact table — Produit / Prix / Stock — shared by the
 * till and the Stock page. Search filters instantly on the catalog already
 * in memory (name, barcode, aisle); tapping a column header sorts (again =
 * reverse), remembered per screen; an aisle bar narrows the list.
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
      if (category && i.category !== category) return false;
      if (!q) return true;
      return fold(i.name || '').includes(q) || (i.barcode || '').includes(q) || fold(getCategoryLabel(i.category)).includes(q);
    });
    const sign = sort.dir === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      if (sort.key === 'price') return sign * ((a.unit_price_cents ?? 0) - (b.unit_price_cents ?? 0));
      if (sort.key === 'stock') return sign * ((a.quantity ?? 0) - (b.quantity ?? 0));
      return sign * (a.name || '').localeCompare(b.name || '');
    });
  }, [items, query, category, sort]);

  const Header = ({ k, label, align }: { k: SortKey; label: string; align: 'left' | 'right' }) => (
    <th className={`px-3 py-2 font-medium ${align === 'right' ? 'text-right' : 'text-left'}`}>
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
              <Header k="name" label="Produit" align="left" />
              <Header k="price" label="Prix" align="right" />
              <Header k="stock" label="Stock" align="right" />
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
                  <td className="px-3 py-2.5 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-foreground truncate">{item.name}</span>
                      {!!qty && (
                        <span className="flex-shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-bold flex items-center justify-center">
                          {qty}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {[item.category && getCategoryLabel(item.category), showStore && item.merchant_name].filter(Boolean).join(' · ') || '—'}
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
