import { computeExchange, effectiveRole, exchangeError, formatMoney, isEligibleRole, ratesFromMarket } from './exchange.rules';

describe("Bureau d'échange — calculs (les mêmes que la fonction SQL exchange_compute)", () => {
  // Rates of the maquette: we buy the dollar at 2 820, sell it at 2 880, the market is 2 850.
  const buy = 2820, sell = 2880, market = 2850;

  it('USD -> CDF au prix d\'achat : 100 $ donnent 282 000 FC, gain 3 000 FC', () => {
    expect(computeExchange('USD', 10000, buy, sell, market)).toEqual({ rate: 2820, to_cents: 28_200_000, gain_cdf_cents: 300_000 });
  });

  it('CDF -> USD au prix de vente : 288 000 FC donnent 100 $, gain 3 000 FC', () => {
    expect(computeExchange('CDF', 28_800_000, buy, sell, market)).toEqual({ rate: 2880, to_cents: 10000, gain_cdf_cents: 300_000 });
  });

  it('arrondit toujours en faveur de la maison : francs entiers vers le bas, centimes de dollar vers le bas', () => {
    // 33,33 $ x 2 820 = 93 990,6 FC -> 93 990 FC
    expect(computeExchange('USD', 3333, buy, sell, market).to_cents).toBe(9_399_000);
    // 100 000 FC / 2 880 = 34,722 $ -> 34,72 $
    expect(computeExchange('CDF', 10_000_000, buy, sell, market).to_cents).toBe(3472);
  });

  it('ne dérive pas sur de gros montants (pas de virgule flottante)', () => {
    // 90 000 000 000 $ (en centimes : 9e12) x 2 820,01 : au-delà de 2^53 en flottant
    const big = computeExchange('USD', 9_000_000_000_000, 2820.01, 2880, 2850);
    expect(big.to_cents).toBe(25_380_090_000_000_000);
  });

  it('un taux de marché hors de la fourchette donne un gain négatif (jamais caché)', () => {
    // On achète à 2 820 alors que le marché est à 2 800 : on a payé trop cher
    expect(computeExchange('USD', 10000, 2820, 2880, 2800).gain_cdf_cents).toBe(-200_000);
  });

  it('« Remplir les deux taux » : marché 2 850 et marge 1 % donnent 2 821,50 et 2 878,50', () => {
    expect(ratesFromMarket(2850, 1)).toEqual({ buy: 2821.5, sell: 2878.5 });
  });
});

describe("Bureau d'échange — qui peut échanger", () => {
  it('clients, marchands et patrons seulement', () => {
    for (const r of ['client', 'merchant', 'enterprise']) expect(isEligibleRole(r)).toBe(true);
    for (const r of ['cashier', 'gerant', 'magasinier', 'vendeur', 'caissier', 'comptable', 'admin', 'super_admin', undefined, null]) {
      expect(isEligibleRole(r as any)).toBe(false);
    }
  });

  it('un patron qui agit au nom d\'un de ses magasins garde ses droits de patron', () => {
    expect(effectiveRole({ role: 'merchant', acting_as_org_id: 'org-1' })).toBe('enterprise');
    expect(effectiveRole({ role: 'merchant' })).toBe('merchant');
    expect(effectiveRole(null)).toBeUndefined();
  });
});

describe("Bureau d'échange — messages clairs pour les refus de la base", () => {
  const body = (e: any) => e.getResponse();
  // fr-FR groups thousands with a narrow no-break space: compare with plain spaces.
  const plain = (text: string) => text.replace(/\s/g, ' ');

  it('les limites disent combien il reste', () => {
    const e = exchangeError('EXCHANGE_DAILY:5000', { fromCurrency: 'USD' })!;
    expect(e.getStatus()).toBe(400);
    expect(body(e)).toMatchObject({ code: 'EXCHANGE_DAILY', remaining_cents: 5000 });
    expect(plain(body(e).message)).toContain('50,00 $US');
    expect(body(exchangeError('EXCHANGE_DAILY:0', { fromCurrency: 'CDF' })!).message).toContain('Réessayez demain');
  });

  it('le minimum et le maximum sont formatés dans la devise donnée', () => {
    expect(plain(body(exchangeError('EXCHANGE_MIN:300000', { fromCurrency: 'CDF' })!).message)).toContain('3 000,00 CDF');
    expect(plain(body(exchangeError('EXCHANGE_MAX:1000000', { fromCurrency: 'USD' })!).message)).toContain('10 000,00 $US');
  });

  it('compte non validé, service coupé, taux périmés, offre expirée ont chacun leur code', () => {
    expect(body(exchangeError('EXCHANGE_NOT_VERIFIED')!).code).toBe('EXCHANGE_NOT_VERIFIED');
    expect(exchangeError('EXCHANGE_NOT_VERIFIED')!.getStatus()).toBe(403);
    expect(body(exchangeError('EXCHANGE_DISABLED')!).code).toBe('EXCHANGE_DISABLED');
    expect(body(exchangeError('EXCHANGE_RATES_STALE')!).code).toBe('EXCHANGE_PAUSED');
    expect(body(exchangeError('EXCHANGE_QUOTE_EXPIRED')!).code).toBe('EXCHANGE_QUOTE_EXPIRED');
    expect(exchangeError('EXCHANGE_QUOTE_EXPIRED')!.getStatus()).toBe(409);
  });

  it('solde insuffisant et erreur inconnue', () => {
    expect(body(exchangeError('Insufficient balance', { fromCurrency: 'USD' })!).message).toBe('Solde insuffisant en dollars.');
    expect(exchangeError('connection reset')).toBeNull();
  });

  it('formate les montants', () => {
    expect(formatMoney(10000, 'USD')).toBe('100,00\u00a0$US');
    expect(formatMoney(28_200_000, 'CDF')).toBe('282\u202f000,00\u00a0CDF');
  });
});
