import { BadRequestException } from '@nestjs/common';

export interface PartnerLogo {
  name: string;
  /** data:image/png|jpeg|webp;base64,… — never SVG (an SVG can carry script). */
  image: string;
}

export interface CardSettings {
  service_phone: string | null;
  web_domain: string | null;
  validity_years: number;
  partner_logos: PartnerLogo[];
}

export const DEFAULT_CARD_SETTINGS: CardSettings = { service_phone: null, web_domain: null, validity_years: 3, partner_logos: [] };

export const MAX_PARTNER_LOGOS = 6;
export const MAX_LOGO_CHARS = 150_000; // ≈ 110 kB of image once decoded: plenty for a 256 px logo
const IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const PHONE = /^\+?[0-9][0-9 ().-]{5,19}$/;

/** Cleans what the super admin typed. An empty field means "not printed". */
export function validateCardSettings(input: any): CardSettings {
  if (!input || typeof input !== 'object') throw new BadRequestException('Réglages invalides.');

  const phoneRaw = typeof input.service_phone === 'string' ? input.service_phone.trim() : '';
  if (phoneRaw && !PHONE.test(phoneRaw)) throw new BadRequestException('Numéro du service client invalide (ex. +243 900 000 000).');

  // The domain only: no scheme, no path — the QR code is built as https://<domain>/c/<token>.
  const domainRaw = typeof input.web_domain === 'string' ? input.web_domain.trim().toLowerCase() : '';
  if (domainRaw && !HOST.test(domainRaw)) throw new BadRequestException('Nom de domaine invalide : saisissez seulement le domaine, par exemple scanlinkpay.com.');

  const years = input.validity_years === undefined ? DEFAULT_CARD_SETTINGS.validity_years : Number(input.validity_years);
  if (!Number.isInteger(years) || years < 1 || years > 10) throw new BadRequestException('La durée de validité doit être de 1 à 10 ans.');

  const logos = input.partner_logos === undefined ? [] : input.partner_logos;
  if (!Array.isArray(logos) || logos.length > MAX_PARTNER_LOGOS) throw new BadRequestException(`Au plus ${MAX_PARTNER_LOGOS} logos.`);
  const partner_logos = logos.map((l: any) => {
    const name = typeof l?.name === 'string' ? l.name.trim() : '';
    if (!name || name.length > 40) throw new BadRequestException('Chaque logo a un nom (40 caractères au plus).');
    if (typeof l?.image !== 'string' || l.image.length > MAX_LOGO_CHARS || !IMAGE.test(l.image)) {
      throw new BadRequestException(`Logo « ${name} » invalide : image PNG, JPEG ou WebP de 110 ko au plus.`);
    }
    return { name, image: l.image };
  });

  return { service_phone: phoneRaw || null, web_domain: domainRaw || null, validity_years: years, partner_logos };
}
