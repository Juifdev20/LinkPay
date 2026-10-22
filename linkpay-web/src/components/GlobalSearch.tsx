import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search } from 'lucide-react';
import type { NavItem } from '@/lib/nav-items';
import { NAV_SECTIONS } from '@/lib/nav-items';
import { cn } from '@/lib/utils';

/** Case- and accent-insensitive ("depense" finds « Dépenses »). */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Other words people type for a page, besides its name. */
const SYNONYMS: Record<string, string> = {
  '/dashboard/pos': 'vente vendre ticket encaisser',
  '/dashboard/organization/sales': 'vente vendre facture',
  '/dashboard/organization/stock': 'produit article inventaire code-barres',
  '/dashboard/organization/restock': 'approvisionnement commande achat',
  '/dashboard/organization/staff': 'employe caissier vendeur gerant magasinier comptable',
  '/dashboard/organization/stores': 'boutique magasin succursale',
  '/dashboard/organization/wallet': 'solde argent retrait recharge',
  '/dashboard/wallet': 'solde salaire retrait',
  '/dashboard/settings': 'code pin mot de passe theme sombre synchronisation',
  '/dashboard/admin/withdrawals': 'retrait virement banque',
  '/dashboard/expenses': 'depense budget',
};

/**
 * The search box of the computer's top bar: finds any screen of the menu by its name (or a usual word for it) and
 * opens it. Ctrl+K (⌘K on a Mac) puts the cursor in it from anywhere; arrows choose, Enter opens, Escape closes.
 */
export function GlobalSearch({ items }: { items: NavItem[] }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    const q = fold(query.trim());
    const list = q
      ? items.filter((i) => fold(`${i.label} ${SYNONYMS[i.to] ?? ''}`).includes(q))
      : items;
    return list.slice(0, 8);
  }, [items, query]);

  useEffect(() => setActive(0), [query]);

  const go = (item?: NavItem) => {
    if (!item) return;
    navigate(item.to);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const sectionTitle = (item: NavItem) => NAV_SECTIONS.find((s) => s.id === item.section)?.title;

  return (
    <div className="relative max-w-md w-full">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="global-search-results"
        aria-label="Rechercher une page"
        placeholder="Rechercher une page…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        // Closing after the click on a result has been handled.
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); go(results[active]); }
          else if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
        }}
        className="w-full pl-10 pr-16 py-2 rounded-lg border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
        Ctrl K
      </kbd>

      {open && (
        <div id="global-search-results" role="listbox" className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
          {results.length ? (
            <ul className="max-h-96 overflow-y-auto py-1.5">
              {results.map((item, i) => (
                <li key={item.to} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(item)}
                    className={cn('flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm', i === active ? 'bg-primary/10 text-primary' : 'text-foreground')}
                  >
                    <item.icon className="h-4 w-4 flex-shrink-0" />
                    <span className="flex-1 truncate font-medium">{item.label}</span>
                    {sectionTitle(item) && <span className="text-xs text-muted-foreground">{sectionTitle(item)}</span>}
                    {i === active && <CornerDownLeft className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Aucune page « {query.trim()} »</p>
          )}
        </div>
      )}
    </div>
  );
}
