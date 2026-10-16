import { CommissionsService } from './commissions.service';

/** 2.5 % commission, no fixed part: 59.00 USD → 1.47 USD platform fee (rounded down). */
const RULE = { id: 'rule-1', percent: '0.025', fixed_cents: 0, min_cents: null, max_cents: null };

describe('CommissionsService.calculateFees — payer total in whole units', () => {
  const make = () => {
    const service = new CommissionsService({} as any);
    jest.spyOn(service as any, 'getActiveRule').mockResolvedValue(RULE);
    return service;
  };

  it('CUSTOMER_PAID on a whole amount: the payer total is rounded UP to the next unit, the merchant net does not move', async () => {
    const fees = await make().calculateFees(5900, 'USD', 'm1', 'CUSTOMER_PAID');
    // Before: 59.00 + 1.47 = 60.47 → refused by FlexPaie (whole units only).
    expect(fees.total_cents).toBe(6100);
    expect(fees.total_cents % 100).toBe(0);
    expect(fees.platform_fee_cents).toBe(200);
    expect(fees.net_cents).toBe(5900 - 88); // amount − PSP fee, unchanged
  });

  it('SHARED on a whole amount: only the payer half is rounded; the merchant half stays the same', async () => {
    const fees = await make().calculateFees(5900, 'USD', 'm1', 'SHARED');
    // Fee 147 → merchant 73, payer 74 → payer rounded to 100.
    expect(fees.total_cents).toBe(6000);
    expect(fees.platform_fee_cents).toBe(173);
    expect(fees.net_cents).toBe(5900 - 88 - 73);
  });

  it('MERCHANT_PAID is untouched: the payer pays exactly the amount', async () => {
    const fees = await make().calculateFees(5900, 'USD', 'm1', 'MERCHANT_PAID');
    expect(fees.total_cents).toBe(5900);
    expect(fees.platform_fee_cents).toBe(147);
    expect(fees.net_cents).toBe(5900 - 88 - 147);
  });

  it('an amount that already has cents is left as it is (no rounding invented on top)', async () => {
    const fees = await make().calculateFees(5950, 'USD', 'm1', 'CUSTOMER_PAID');
    expect(fees.platform_fee_cents).toBe(148);
    expect(fees.total_cents).toBe(5950 + 148);
  });

  it('an already whole payer fee is not bumped by a full unit', async () => {
    const service = new CommissionsService({} as any);
    jest.spyOn(service as any, 'getActiveRule').mockResolvedValue({ ...RULE, percent: '0', fixed_cents: 100 });
    const fees = await service.calculateFees(5900, 'USD', 'm1', 'CUSTOMER_PAID');
    expect(fees.platform_fee_cents).toBe(100);
    expect(fees.total_cents).toBe(6000);
  });
});
