import { BadRequestException } from '@nestjs/common';
import { PaymentRequestsController } from './payment-requests.controller';

describe('quick-pay with options and fees preview', () => {
  const org = { legal_name: 'Hôtel Chicago SARL', name: 'Hôtel Chicago', merchants: [{ id: 'm1', name: 'Réception' }] };
  const make = (orgOverride: any = org) => {
    const service = {
      createPaymentRequest: jest.fn().mockResolvedValue({ id: 'r1', reference: 'PR-1', link_token: 't', fees: { total_cents: 5150 } }),
      previewFees: jest.fn().mockResolvedValue({ currency: 'USD', total_cents: 5150, net_cents: 4800 }),
    };
    const orgs = { getOrganizationByScanLinkPayNumber: jest.fn().mockResolvedValue(orgOverride) };
    return { controller: new PaymentRequestsController(service as any, orgs as any), service, orgs };
  };

  it('passes the commission model, the cleaned label and the expiry to the payment request', async () => {
    const { controller, service } = make();
    await controller.quickPay({ scanlinkpay_number: 'SLP-1', amount_cents: 5000, currency: 'USD', commission_model: 'CUSTOMER_PAID', description: '  Acompte\n\tréservation  ', expires_in_minutes: 60 } as any);
    expect(service.createPaymentRequest).toHaveBeenCalledWith(
      'm1',
      undefined,
      { amount_cents: 5000, currency: 'USD', description: 'Acompte réservation', commission_model: 'CUSTOMER_PAID', expires_in_minutes: 60 },
      { withQrCode: false },
    );
  });

  it('keeps the previous behaviour when no option is given (merchant pays, generic label)', async () => {
    const { controller, service } = make();
    await controller.quickPay({ scanlinkpay_number: 'SLP-1', amount_cents: 5000, currency: 'USD' } as any);
    expect(service.createPaymentRequest.mock.calls[0][2]).toMatchObject({ description: 'Paiement via numéro ScanLinkPay SLP-1', commission_model: undefined });
  });

  it('previews the fees for the right store and names the business', async () => {
    const { controller, service } = make();
    const r = await controller.feesPreview({ scanlinkpay_number: 'SLP-1', amount_cents: '5000', currency: 'USD', commission_model: 'CUSTOMER_PAID' } as any);
    expect(service.previewFees).toHaveBeenCalledWith('m1', 5000, 'USD', 'CUSTOMER_PAID', { business: 'Hôtel Chicago SARL' });
    expect(r.total_cents).toBe(5150);
  });

  it('refuses an absurd amount without touching anything', async () => {
    const { controller, service } = make();
    for (const amount of ['abc', '50', '1.5', '999999999999999']) {
      await expect(controller.feesPreview({ scanlinkpay_number: 'SLP-1', amount_cents: amount } as any)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(service.previewFees).not.toHaveBeenCalled();
  });

  it('a business with several stores must say which one', async () => {
    const { controller } = make({ ...org, merchants: [{ id: 'a' }, { id: 'b' }] });
    await expect(controller.feesPreview({ scanlinkpay_number: 'SLP-1', amount_cents: '5000' } as any)).rejects.toThrow(/merchant_id/);
  });
});
