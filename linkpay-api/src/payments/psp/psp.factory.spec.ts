import { ServiceUnavailableException } from '@nestjs/common';
import { PspFactory } from './psp.factory';

const make = (PSP_PROVIDER?: string) =>
  new PspFactory({ get: (k: string, d?: any) => (k === 'PSP_PROVIDER' ? PSP_PROVIDER ?? d : d) } as any, { provider: 'flexpaie' } as any);

describe('PspFactory — real money only', () => {
  it('no simulated provider: "mock" is refused, and so is a missing PSP_PROVIDER (no silent default)', () => {
    expect(() => make('mock').get()).toThrow(ServiceUnavailableException);
    expect(() => make(undefined).get()).toThrow(ServiceUnavailableException);
    expect(() => make('flexpaie').get('mock')).toThrow(ServiceUnavailableException);
    expect(make('flexpaie').getAvailableProviders()).toEqual(['flexpaie']);
    expect(() => make('autre').get()).toThrow(ServiceUnavailableException);
  });
  it('on the TEST database (migration 071), every real payment is refused', async () => {
    const supabase = { getClient: () => ({ from: () => ({ select: () => ({ maybeSingle: async () => ({ data: { name: 'test' }, error: null }) }) }) }) };
    const f = new PspFactory({ get: (k: string, d?: any) => (k === 'PSP_PROVIDER' ? 'flexpaie' : d) } as any, { provider: 'flexpaie' } as any, supabase as any);
    await f.onModuleInit();
    expect(() => f.get()).toThrow(/Base de test/);
  });

  it('production database, or 071 not applied yet: the real provider works', async () => {
    for (const answer of [{ data: { name: 'production' }, error: null }, { data: null, error: { message: 'relation "platform_environment" does not exist' } }]) {
      const supabase = { getClient: () => ({ from: () => ({ select: () => ({ maybeSingle: async () => answer }) }) }) };
      const f = new PspFactory({ get: (k: string, d?: any) => (k === 'PSP_PROVIDER' ? 'flexpaie' : d) } as any, { provider: 'flexpaie' } as any, supabase as any);
      await f.onModuleInit();
      expect(f.get().provider).toBe('flexpaie');
    }
  });

  it('the configured real provider is used', () => {
    expect(make('flexpaie').get().provider).toBe('flexpaie');
  });
});
