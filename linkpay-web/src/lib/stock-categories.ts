import {
  Smartphone, Laptop, Cpu, Headphones, Cable, ShoppingBasket, CupSoda, Croissant, Milk, Apple,
  Beef, Sparkles, SprayCan, Baby, Package, type LucideIcon,
} from 'lucide-react';

export type AttributeField = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select';
  options?: string[];
  unit?: string;
  placeholder?: string;
};

export type StockCategory = {
  value: string;
  label: string;
  icon: LucideIcon;
  /** Example sub-types shown as a combobox — free text is still allowed,
   * these are suggestions, not an exhaustive enum (new product kinds show
   * up constantly in this sector). */
  itemTypes: string[];
  /** Category-specific spec fields, stored in stock_items.attributes
   * (JSONB) — kept out of the DB schema entirely since they vary too much
   * between categories to model as columns (see migration 033). */
  fields: AttributeField[];
};

export const STOCK_CATEGORIES: StockCategory[] = [
  {
    value: 'telephonie_mobilite',
    label: 'Téléphonie & Mobilité',
    icon: Smartphone,
    itemTypes: ['Smartphone', 'Tablette', 'Téléphone simple (touches)'],
    fields: [
      { key: 'storage_gb', label: 'Stockage', type: 'number', unit: 'Go' },
      { key: 'ram_gb', label: 'RAM', type: 'number', unit: 'Go' },
      { key: 'color', label: 'Couleur', type: 'text' },
      { key: 'imei', label: 'IMEI / Numéro de série', type: 'text' },
    ],
  },
  {
    value: 'ordinateurs',
    label: 'Ordinateurs',
    icon: Laptop,
    itemTypes: ['PC portable', 'Ordinateur de bureau'],
    fields: [
      { key: 'processor', label: 'Processeur', type: 'text', placeholder: 'Intel Core i5-1235U' },
      { key: 'ram_gb', label: 'RAM', type: 'number', unit: 'Go' },
      { key: 'storage', label: 'Stockage', type: 'text', placeholder: '512 Go SSD' },
      { key: 'gpu', label: 'Carte graphique', type: 'text' },
      { key: 'os', label: "Système d'exploitation", type: 'text', placeholder: 'Windows 11' },
    ],
  },
  {
    value: 'composants_informatiques',
    label: 'Composants informatiques',
    icon: Cpu,
    itemTypes: ['Processeur (CPU)', 'Carte graphique (GPU)', 'Carte mère', 'Barrette RAM', 'Disque dur (SSD)', 'Disque dur (HDD)'],
    fields: [
      { key: 'compatibility', label: 'Socket / Compatibilité', type: 'text', placeholder: 'LGA1700, AM5...' },
      { key: 'capacity', label: 'Capacité / Fréquence', type: 'text', placeholder: '1 To, 3200 MHz...' },
    ],
  },
  {
    value: 'audio_hifi',
    label: 'Audio & Hi-Fi',
    icon: Headphones,
    itemTypes: ['Casque audio', 'Écouteurs filaires', 'Écouteurs sans fil', 'Amplificateur'],
    fields: [
      { key: 'connectivity', label: 'Connectivité', type: 'select', options: ['Filaire', 'Bluetooth', 'Sans fil (autre)'] },
      { key: 'color', label: 'Couleur', type: 'text' },
      { key: 'battery_life_h', label: 'Autonomie', type: 'number', unit: 'h' },
    ],
  },
  {
    value: 'accessoires',
    label: 'Accessoires',
    icon: Cable,
    itemTypes: ['Câble USB', 'Chargeur téléphone', 'Chargeur PC', 'Powerbank', 'Adaptateur', 'Boîtier chargeur'],
    fields: [
      { key: 'connector', label: 'Type de connecteur', type: 'select', options: ['USB-C', 'Micro-USB', 'Lightning', 'USB-A', 'Autre'] },
      { key: 'length_m', label: 'Longueur', type: 'number', unit: 'm' },
      { key: 'power_w', label: 'Puissance', type: 'number', unit: 'W' },
      { key: 'color', label: 'Couleur', type: 'text' },
    ],
  },
];

// ------------------------------------------------------------------
// Supermarket / food aisles ("rayons"). The stored value IS the label
// (free-text category column — see stock.controller.ts), which keeps the
// products created before this list existed ("Boulangerie", "Alimentation")
// matching it. No spec fields: a supermarket product is name, code, aisle,
// price, quantity.
// ------------------------------------------------------------------
const aisle = (label: string, icon: LucideIcon): StockCategory => ({ value: label, label, icon, itemTypes: [], fields: [] });

const SUPERMARKET_CATEGORIES: StockCategory[] = [
  aisle('Alimentation', ShoppingBasket),
  aisle('Boissons', CupSoda),
  aisle('Boulangerie', Croissant),
  aisle('Produits frais & laitiers', Milk),
  aisle('Fruits & légumes', Apple),
  aisle('Viande & poisson', Beef),
  aisle('Hygiène & beauté', Sparkles),
  aisle('Entretien ménager', SprayCan),
  aisle('Bébé', Baby),
  aisle('Autre', Package),
];

const FOOD_CATEGORIES: StockCategory[] = [
  aisle('Alimentation', ShoppingBasket),
  aisle('Boissons', CupSoda),
  aisle('Boulangerie', Croissant),
  aisle('Produits frais & laitiers', Milk),
  aisle('Fruits & légumes', Apple),
  aisle('Viande & poisson', Beef),
  aisle('Autre', Package),
];

export type SectorConfig = {
  categories: StockCategory[];
  /** Electronics-only spec fields: brand, model, serial/IMEI, condition,
   *  warranty, item type and per-category attributes. */
  technicalFields: boolean;
  namePlaceholder: string;
};

/** What the product sheet shows for an organization's sector
 *  (organizations.sector — see SECTORS in OnboardingWizard.tsx). */
export function getSectorConfig(sector?: string | null): SectorConfig {
  if (sector === 'electronique') {
    return { categories: STOCK_CATEGORIES, technicalFields: true, namePlaceholder: 'Samsung Galaxy A54' };
  }
  if (sector === 'alimentation') {
    return { categories: FOOD_CATEGORIES, technicalFields: false, namePlaceholder: 'Farine de maïs 25 kg' };
  }
  // Supermarket — also the default: the simplest sheet.
  return { categories: SUPERMARKET_CATEGORIES, technicalFields: false, namePlaceholder: 'Riz parfumé 5 kg' };
}

const ALL_CATEGORIES = [...STOCK_CATEGORIES, ...SUPERMARKET_CATEGORIES];

export function getCategoryLabel(value?: string | null): string {
  return ALL_CATEGORIES.find((c) => c.value === value)?.label || value || '—';
}

export function getCategoryIcon(value?: string | null): LucideIcon {
  return ALL_CATEGORIES.find((c) => c.value === value)?.icon || Package;
}
