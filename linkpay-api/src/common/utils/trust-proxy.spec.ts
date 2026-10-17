import { configureTrustProxy, resolveTrustProxyHops } from './trust-proxy';

describe('resolveTrustProxyHops', () => {
  it('trusts one proxy hop in production (Render)', () => {
    expect(resolveTrustProxyHops({ NODE_ENV: 'production' })).toBe(1);
  });
  it('trusts none in development, so a client cannot fake its IP', () => {
    expect(resolveTrustProxyHops({ NODE_ENV: 'development' })).toBe(0);
    expect(resolveTrustProxyHops({})).toBe(0);
  });
  it('can be overridden, and ignores nonsense', () => {
    expect(resolveTrustProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '2' })).toBe(2);
    expect(resolveTrustProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '0' })).toBe(0);
    expect(resolveTrustProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: 'abc' })).toBe(0);
    expect(resolveTrustProxyHops({ NODE_ENV: 'production', TRUST_PROXY_HOPS: '-1' })).toBe(0);
  });
});

describe('configureTrustProxy', () => {
  it('sets Express "trust proxy" only when there are hops to trust', () => {
    const app = { set: jest.fn() };
    configureTrustProxy(app, 1);
    expect(app.set).toHaveBeenCalledWith('trust proxy', 1);
    const none = { set: jest.fn() };
    configureTrustProxy(none, 0);
    expect(none.set).not.toHaveBeenCalled();
  });
});
