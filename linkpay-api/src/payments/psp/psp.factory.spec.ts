import { ServiceUnavailableException } from '@nestjs/common';
import { PspFactory } from './psp.factory';

const make = (PSP_PROVIDER?: string) =>
  new PspFactory({ get: (k: string, d?: any) => (k === 'PSP_PROVIDER' ? PSP_PROVIDER ?? d : d) } as any, { provider: 'cinetpay' } as any, { provider: 'flexpaie' } as any);

describe('PspFactory — real money only', () => {
  it('no simulated provider: "mock" is refused, and so is a missing PSP_PROVIDER (no silent default)', () => {
    expect(() => make('mock').get()).toThrow(ServiceUnavailableException);
    expect(() => make(undefined).get()).toThrow(ServiceUnavailableException);
    expect(() => make('flexpaie').get('mock')).toThrow(ServiceUnavailableException);
    expect(make('flexpaie').getAvailableProviders()).toEqual(['cinetpay', 'flexpaie']);
  });
  it('the configured real provider is used', () => {
    expect(make('flexpaie').get().provider).toBe('flexpaie');
  });
});
