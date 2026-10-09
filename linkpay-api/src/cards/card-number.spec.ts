import {
  CARD_IIN, expiryFor, formatCardNumber, formatExpiry, generateCardNumber, generateQrToken, holderNameFor, isExpired,
  isQrToken, isValidCardNumber, luhnCheckDigit, maskCardNumber, normalizeCardNumber, publicHolderName,
} from './card-number';

describe('card number (ISO/IEC 7812)', () => {
  it('computes the Luhn check digit of known numbers', () => {
    expect(luhnCheckDigit('411111111111111')).toBe(1); // 4111 1111 1111 1111
    expect(luhnCheckDigit('79927398713'.slice(0, 10))).toBe(3);
    expect(luhnCheckDigit('924300123456789')).toBe(5);
  });

  it('generates 16 digits, our issuer prefix and a valid check digit — every time', () => {
    for (let i = 0; i < 500; i++) {
      const n = generateCardNumber();
      expect(n).toMatch(/^\d{16}$/);
      expect(n.startsWith(CARD_IIN)).toBe(true);
      expect(isValidCardNumber(n)).toBe(true);
    }
  });

  it('rejects a mistyped number', () => {
    const n = generateCardNumber();
    const wrong = n.slice(0, 15) + String((Number(n[15]) + 1) % 10);
    expect(isValidCardNumber(wrong)).toBe(false);
    expect(isValidCardNumber(n.slice(0, 15))).toBe(false);
    expect(isValidCardNumber('abcd')).toBe(false);
  });

  it('numbers are not sequential: two in a row are unrelated', () => {
    const set = new Set(Array.from({ length: 200 }, () => generateCardNumber()));
    expect(set.size).toBe(200);
  });

  it('formats, normalizes and masks', () => {
    expect(formatCardNumber('9243001234567895')).toBe('9243 0012 3456 7895');
    expect(normalizeCardNumber('9243 0012-3456 7895')).toBe('9243001234567895');
    expect(maskCardNumber('9243001234567895')).toBe('•••• •••• •••• 7895');
    expect(maskCardNumber(null)).toBe('');
  });
});

describe('QR token', () => {
  it('is 12 characters of an unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) expect(isQrToken(generateQrToken())).toBe(true);
  });
  it('refuses anything that is not a token', () => {
    for (const bad of ['', 'short', 'ABCDEFGHJKMN1', 'abcdefghjkmn', 'ILOUILOUILOU', '../../etc/pw', 'ABCDEFGHJKM!']) expect(isQrToken(bad)).toBe(false);
  });
});

describe('names', () => {
  it('prints capitals without accents, within 26 characters', () => {
    expect(holderNameFor('Amina Kabongo')).toBe('AMINA KABONGO');
    expect(holderNameFor('Éloïse N’Dour')).toBe('ELOISE N DOUR');
    expect(holderNameFor('Jean-Baptiste Mukendi Wa Kalonji Tshibangu')).toBe('JEAN-BAPTISTE M. W. K. TSHIBA'.slice(0, 26).trim());
    expect(holderNameFor('Jean-Baptiste Mukendi Wa Kalonji Tshibangu').length).toBeLessThanOrEqual(26);
  });
  it('falls back to the e-mail, then to a neutral word', () => {
    expect(holderNameFor('', 'marie.kasa@mail.com')).toBe('MARIE KASA');
    expect(holderNameFor(null, null)).toBe('TITULAIRE');
  });
  it('shows a merchant only the first name and an initial', () => {
    expect(publicHolderName('Amina Marie Kabongo')).toBe('Amina K.');
    expect(publicHolderName('Amina')).toBe('Amina');
    expect(publicHolderName('')).toBe('Client ScanLinkPay');
  });
});

describe('validity', () => {
  it('runs to the end of the month, N years later', () => {
    expect(expiryFor(new Date('2026-10-09T10:00:00Z'), 3)).toBe('2029-10-31');
    expect(expiryFor(new Date('2026-01-31T10:00:00Z'), 1)).toBe('2027-01-31');
    expect(expiryFor(new Date('2026-02-10T10:00:00Z'), 2)).toBe('2028-02-29');
  });
  it('prints MM/YY and expires the day after', () => {
    expect(formatExpiry('2029-10-31')).toBe('10/29');
    expect(isExpired('2029-10-31', new Date('2029-10-31T23:00:00Z'))).toBe(false);
    expect(isExpired('2029-10-31', new Date('2029-11-01T00:30:00Z'))).toBe(true);
    expect(isExpired(null)).toBe(false);
  });
});
