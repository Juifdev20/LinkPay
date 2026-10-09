import type { CardFaceData, PartnerLogo } from '@/components/card/ScanLinkPayCard';

export interface MyCard {
  id: string;
  status: 'requested' | 'issued' | 'active' | 'frozen' | 'blocked' | 'replaced' | 'expired';
  serial_no: number;
  holder_name: string | null;
  expires_on: string | null;
  blocked_reason: string | null;
  card_number: string | null;
  card_number_masked: string;
  qr_url: string | null;
}

export interface MyCardResponse {
  card: MyCard | null;
  can_request: boolean;
  balances: { CDF: number; USD: number };
  display: { service_phone: string | null; web_domain: string | null; partner_logos: PartnerLogo[] };
}

/** "9243001234567895" → "9243 0012 3456 7895" */
export const groupDigits = (digits: string) => digits.replace(/\D/g, '').slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ');

/** "2029-10-31" → "10/29" */
export const validThru = (iso?: string | null) => (iso ? `${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '--/--');

export const STATUS_LABEL: Record<MyCard['status'], string> = {
  requested: 'Demande en cours',
  issued: 'À activer',
  active: 'Active',
  frozen: 'En pause',
  blocked: 'Bloquée',
  replaced: 'Remplacée',
  expired: 'Expirée',
};

export function cardFaceData(res: MyCardResponse, fallbackName: string, revealed: boolean): CardFaceData {
  const c = res.card;
  const live = c && c.card_number && c.status !== 'blocked' && c.status !== 'replaced';
  return {
    holderName: (c?.holder_name || fallbackName || 'TITULAIRE').toUpperCase(),
    numberText: live ? (revealed ? groupDigits(c!.card_number!) : `•••• •••• •••• ${c!.card_number!.slice(12)}`) : '•••• •••• •••• ••••',
    validThru: validThru(c?.expires_on),
    serialNo: c?.serial_no,
    qrUrl: live ? c!.qr_url : null,
    servicePhone: res.display.service_phone,
    webDomain: res.display.web_domain,
    partnerLogos: res.display.partner_logos,
  };
}
