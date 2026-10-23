import { CommissionsService } from './commissions.service';

/** 2.5 % commission, no fixed part: 59.00 USD → 1.47 USD platform fee (rounded down). */
const RULE = { id: 'rule-1', percent: '0.025', fixed_cents: 0, min_cents: null, max_cents: null };

describe('CommissionsService.calculateFees — the payer never pays more than the real commission', () => {
  const make = (rule: any = RULE) => {
    const service = new CommissionsService({} as any);
    jest.spyOn(service as any, 'getActiveRule').mockResolvedValue(rule);
    return service;
  };

  it('CUSTOMER_PAID on a whole amount: the payer pays the whole units of the commission, the cents go to the merchant', async () => {
    const fees = await make().calculateFees(5900, 'USD', 'm1', 'CUSTOMER_PAID');
    // 59.00 + 1.47 → the payer pays 60.00 (whole units, accepted by FlexPaie); the merchant bears the 0.47.
    expect(fees.total_cents).toBe(6000);
    expect(fees.platform_fee_cents).toBe(147); // ScanLinkPay's commission does not move
    expect(fees.net_cents).toBe(5900 - 47);
  });

  it('the 1 USD subscription: a 0.05 USD commission is no longer turned into 1 USD for the payer', async () => {
    const fees = await make({ ...RULE, min_cents: 5 }).calculateFees(100, 'USD', 'm1', 'CUSTOMER_PAID');
    expect(fees.total_cents).toBe(100); // was 200 (then 204 with FlexPaie's own fee)
    expect(fees.platform_fee_cents).toBe(5);
    expect(fees.net_cents).toBe(95);
  });

  it('SHARED on a whole amount: the payer half is rounded down, the merchant half takes the cents', async () => {
    const fees = await make().calculateFees(5900, 'USD', 'm1', 'SHARED');
    // Fee 147 → merchant 73, payer 74 → payer 0 (whole units), merchant 147.
    expect(fees.total_cents).toBe(5900);
    expect(fees.platform_fee_cents).toBe(147);
    expect(fees.net_cents).toBe(5900 - 147);
    const big = await make().calculateFees(100000, 'USD', 'm1', 'SHARED');
    // Fee 2500 → merchant 1250, payer 1250 → payer 1200, merchant 1300.
    expect(big.total_cents).toBe(101200);
    expect(big.net_cents).toBe(100000 - 1300);
  });

  it('MERCHANT_PAID: the payer pays exactly the amount, the merchant the commission — and no provider fee is held back', async () => {
    const fees = await make().calculateFees(5900, 'USD', 'm1', 'MERCHANT_PAID');
    expect(fees.total_cents).toBe(5900);
    expect(fees.platform_fee_cents).toBe(147);
    expect(fees.psp_fee_cents).toBe(0); // FlexPaie bills the payer its own fee
    expect(fees.net_cents).toBe(5900 - 147);
  });

  it('an amount that already has cents is left as it is (no rounding invented on top)', async () => {
    const fees = await make().calculateFees(5950, 'USD', 'm1', 'CUSTOMER_PAID');
    expect(fees.platform_fee_cents).toBe(148);
    expect(fees.total_cents).toBe(5950 + 148);
    expect(fees.net_cents).toBe(5950);
  });

  it('an already whole payer fee is passed on as it is', async () => {
    const fees = await make({ ...RULE, percent: '0', fixed_cents: 100 }).calculateFees(5900, 'USD', 'm1', 'CUSTOMER_PAID');
    expect(fees.platform_fee_cents).toBe(100);
    expect(fees.total_cents).toBe(6000);
    expect(fees.net_cents).toBe(5900);
  });
});
