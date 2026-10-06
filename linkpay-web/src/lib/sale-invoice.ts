import { formatCurrency } from '@/lib/utils';
import { publicOrigin } from '@/lib/share';
import { STOCK_CATEGORIES } from '@/lib/stock-categories';

/**
 * One data model for every invoice output — the on-screen/print invoice and
 * the PDF — so the two can never disagree about what a sale says.
 */

const CONDITIONS: Record<string, string> = { neuf: 'Neuf', occasion: 'Occasion', reconditionne: 'Reconditionné' };

export interface InvoiceOrg {
  name: string;
  legal_name?: string | null;
  description?: string | null;
  receipt_footer_message?: string | null;
  contact?: { address?: { avenue?: string; commune?: string; city?: string } } | null;
  owner_phone?: string | null;
  scanlinkpay_number?: string | null;
  logo_url?: string | null;
}

export interface InvoiceSale {
  reference: string;
  currency: string;
  total_cents: number;
  created_at?: string;
  link_token?: string;
  sale_items: {
    name: string;
    category?: string | null;
    quantity: number;
    unit_price_cents: number;
    details?: {
      category?: string | null;
      brand?: string | null;
      model?: string | null;
      condition?: string | null;
      serial_number?: string | null;
      warranty_months?: number | null;
      attributes?: Record<string, unknown> | null;
    } | null;
  }[];
}

export interface InvoiceSpec {
  label: string;
  value: string;
}

export interface InvoiceLine {
  /** Product name, then brand and model, e.g. "Pixel 3A". */
  title: string;
  /** Structured characteristics: brand, model, storage, RAM, ... */
  specs: InvoiceSpec[];
  quantity: number;
  unitPrice: string;
  total: string;
}

export interface InvoiceModel {
  businessName: string;
  address: string;
  phone: string | null;
  slogan: string | null;
  footerMessage: string | null;
  reference: string;
  dateTime: string;
  lines: InvoiceLine[];
  total: string;
  /** Payment QR of this sale (fixed amount). */
  salePaymentUrl: string | null;
  scanlinkpayNumber: string | null;
}

/**
 * Characteristics printed for a line: the product's own fields only (the
 * category decides which attributes exist, so a phone never shows a
 * connector, and a laptop never shows an IMEI). Labels and units come from
 * the category definition, so they match what the seller typed.
 */
function lineSpecs(line: InvoiceSale['sale_items'][number]): InvoiceSpec[] {
  const d = line.details;
  if (!d) return [];
  const category = STOCK_CATEGORIES.find((c) => c.value === (d.category || line.category));
  const specs: InvoiceSpec[] = [];
  if (d.brand) specs.push({ label: 'Marque', value: d.brand });
  if (d.model) specs.push({ label: 'Modèle', value: d.model });
  if (d.condition) specs.push({ label: 'État', value: CONDITIONS[d.condition] || d.condition });

  const attributes = d.attributes || {};
  for (const field of category?.fields || []) {
    const raw = attributes[field.key];
    if (raw === '' || raw == null) continue;
    specs.push({ label: field.label, value: `${String(raw)}${field.unit ? ` ${field.unit}` : ''}` });
  }

  if (d.serial_number) specs.push({ label: 'N° de série / IMEI', value: d.serial_number });
  if (d.warranty_months != null) specs.push({ label: 'Garantie', value: `${d.warranty_months} mois` });
  return specs;
}

export function formatInvoiceDateTime(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const date = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${date} à ${time}`;
}

export function buildInvoiceModel(org: InvoiceOrg, sale: InvoiceSale): InvoiceModel {
  const address = [org.contact?.address?.avenue, org.contact?.address?.commune, org.contact?.address?.city]
    .filter(Boolean)
    .join(', ');

  return {
    businessName: org.legal_name || org.name,
    address,
    phone: org.owner_phone || null,
    slogan: org.description || null,
    footerMessage: org.receipt_footer_message || null,
    reference: sale.reference,
    dateTime: formatInvoiceDateTime(sale.created_at),
    lines: sale.sale_items.map((line) => {
      const brand = line.details?.brand?.trim();
      const model = line.details?.model?.trim();
      const brandModel = brand && model && brand.toLowerCase() !== model.toLowerCase() ? `${brand} ${model}` : brand || model || '';
      // "Pixel 3A" when the brand/model are not already in the product name.
      const title = brandModel && !line.name.toLowerCase().includes(brandModel.toLowerCase())
        ? `${line.name} ${brandModel}`
        : line.name;
      return {
        title,
        specs: lineSpecs(line),
        quantity: line.quantity,
        unitPrice: formatCurrency(line.unit_price_cents, sale.currency),
        total: formatCurrency(line.unit_price_cents * line.quantity, sale.currency),
      };
    }),
    total: formatCurrency(sale.total_cents, sale.currency),
    salePaymentUrl: sale.link_token ? `${publicOrigin()}/p/${sale.link_token}` : null,
    scanlinkpayNumber: org.scanlinkpay_number || null,
  };
}
