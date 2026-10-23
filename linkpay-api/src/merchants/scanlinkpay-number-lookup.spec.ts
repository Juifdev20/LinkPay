import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { MerchantsService } from './merchants.service';
import { createFakeSupabase } from '../test-utils/fake-supabase';

const service = (answer: { data?: any; error?: any }) => new MerchantsService(createFakeSupabase(() => answer).service, {} as any, { get: () => '' } as any);

describe('MerchantsService.getMerchantByScanLinkPayNumber', () => {
  it('an empty answer is "introuvable"', async () => {
    await expect(service({ data: null }).getMerchantByScanLinkPayNumber('SLP-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a database failure is NOT reported as "this number does not exist" (the caller would blame the number)', async () => {
    const err: any = await service({ data: null, error: { message: 'Could not embed because more than one relationship was found' } }).getMerchantByScanLinkPayNumber('SLP-1').catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.message).not.toMatch(/introuvable/i);
  });

  it('a found merchant is returned as a single store', async () => {
    const r = await service({ data: { id: 'm1', name: 'HotelSaver', legal_name: null, logo_url: null, scanlinkpay_number: 'SLP-1', organization: null } }).getMerchantByScanLinkPayNumber('SLP-1');
    expect(r.merchants).toEqual([{ id: 'm1', name: 'HotelSaver', logo_url: null }]);
  });
});
