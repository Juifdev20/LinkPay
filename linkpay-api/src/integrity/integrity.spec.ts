import { BadRequestException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { createPublicKey, createVerify, generateKeyPairSync } from 'crypto';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';
import { DeviceIntegrityService, cleanPlatform } from './device-integrity.service';
import { DeviceIntegrityGuard } from './device-integrity.guard';
import { evaluateIntegrity, normalizeDigest, PlayIntegrityPayload } from './integrity-policy';
import { GoogleServiceAuth } from './google-service-auth';

const PKG = 'com.scanlinkpay.app';
const NOW = Date.parse('2026-06-15T10:00:00Z');
const goodPayload = (nonce: string, over: Partial<PlayIntegrityPayload> = {}): PlayIntegrityPayload => ({
  requestDetails: { requestPackageName: PKG, nonce, timestampMillis: String(NOW - 5_000) },
  appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName: PKG, certificateSha256Digest: [Buffer.from('ab'.repeat(32), 'hex').toString('base64url')] },
  deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY', 'MEETS_BASIC_INTEGRITY'] },
  ...over,
});
const expected = (over = {}) => ({ packageName: PKG, nonce: 'N', certDigests: [] as string[], requireRecognized: true, now: NOW, ...over });

describe('evaluateIntegrity', () => {
  it('trusts a genuine app on a certified device', () => {
    expect(evaluateIntegrity(goodPayload('N'), expected())).toEqual({ trusted: true, reasons: [] });
  });

  it('rejects a rooted/emulated device (no MEETS_DEVICE_INTEGRITY), whatever else is fine', () => {
    const p = goodPayload('N', { deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_BASIC_INTEGRITY'] } });
    expect(evaluateIntegrity(p, expected()).reasons).toEqual(['device_not_certified']);
    expect(evaluateIntegrity(goodPayload('N', { deviceIntegrity: {} }), expected()).reasons).toContain('device_not_certified');
  });

  it('rejects a repackaged app, a wrong package, a wrong signing certificate', () => {
    expect(evaluateIntegrity(goodPayload('N', { appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION' } }), expected()).reasons).toContain('app_not_recognized');
    expect(evaluateIntegrity(goodPayload('N', { requestDetails: { requestPackageName: 'evil.app', nonce: 'N', timestampMillis: NOW } }), expected()).reasons).toContain('wrong_package');
    expect(evaluateIntegrity(goodPayload('N'), expected({ certDigests: ['cd'.repeat(32)] })).reasons).toContain('wrong_signing_cert');
  });

  it('accepts our certificate whether it is given as hex with colons or base64url', () => {
    const hex = 'ab'.repeat(32);
    expect(evaluateIntegrity(goodPayload('N'), expected({ certDigests: [hex.match(/../g)!.join(':').toUpperCase()] })).trusted).toBe(true);
    expect(normalizeDigest(Buffer.from(hex, 'hex').toString('base64url'))).toBe(hex);
  });

  it('can allow APKs distributed outside Google Play', () => {
    const p = goodPayload('N', { appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION' } });
    expect(evaluateIntegrity(p, expected({ requireRecognized: false })).trusted).toBe(true);
  });

  it('rejects an old verdict, a wrong challenge, an unreadable one; and the app\'s own root report only ever adds suspicion', () => {
    const old = goodPayload('N', { requestDetails: { requestPackageName: PKG, nonce: 'N', timestampMillis: NOW - 3_600_000 } });
    expect(evaluateIntegrity(old, expected()).reasons).toContain('stale_token');
    expect(evaluateIntegrity(goodPayload('OTHER'), expected()).reasons).toContain('nonce_mismatch');
    expect(evaluateIntegrity(null, expected()).reasons).toEqual(['unreadable_verdict']);
    expect(evaluateIntegrity(goodPayload('N'), expected(), ['su_binary'], true).reasons).toEqual(['client_reports_root']);
  });
});

function setup(env: Record<string, string> = {}, rows: Record<string, any> = {}) {
  const inserted: any[] = [];
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'device_attestations') {
      if (q.calls.some((c) => c.method === 'insert')) {
        inserted.push(q.calls.find((c) => c.method === 'insert')!.args[0]);
        return rows.insertError ? { error: { message: rows.insertError } } : { data: null };
      }
      return rows.attestationError ? { error: { message: 'relation does not exist' } } : { data: rows.attestation ?? null };
    }
    if (q.target === 'profiles') return { data: rows.profile ?? { active_client_platform: null } };
    return { data: null };
  });
  const alerts = { alert: jest.fn(async () => undefined) };
  const config = { get: (k: string) => ({ JWT_SECRET: 'j'.repeat(48), PLAY_INTEGRITY_CLIENT_EMAIL: 'sa@p.iam', PLAY_INTEGRITY_PRIVATE_KEY: 'k', ...env })[k] };
  const service = new DeviceIntegrityService(config as any, fake.service, alerts as any);
  return { service, alerts, inserted, fake };
}

describe('DeviceIntegrityService — challenge', () => {
  it('a nonce is bound to its user, expires, and can\'t be forged', () => {
    const { service } = setup();
    const n = service.issueNonce('u1', NOW);
    expect(service.verifyNonce('u1', n, NOW + 1000)).toBe(true);
    expect(service.verifyNonce('u2', n, NOW + 1000)).toBe(false);
    expect(service.verifyNonce('u1', n, NOW + 11 * 60_000)).toBe(false);
    expect(service.verifyNonce('u1', n.slice(0, -2) + 'AA', NOW)).toBe(false);
    expect(service.verifyNonce('u1', 'short', NOW)).toBe(false);
    expect(service.issueNonce('u1', NOW)).not.toBe(n);
    expect(Buffer.from(n, 'base64url').length).toBeGreaterThanOrEqual(16);
  });
});

describe('DeviceIntegrityService.verify', () => {
  it('records a trusted device and returns how long it stays valid', async () => {
    const { service, inserted, alerts } = setup({ DEVICE_INTEGRITY_MODE: 'warn' });
    const nonce = service.issueNonce('u1', NOW);
    jest.spyOn(service as any, 'decode').mockResolvedValue(goodPayload(nonce));
    const res = await service.verify('u1', { token: 't', signals: [], rooted: false, appVersion: '1.0' }, NOW);
    expect(res).toEqual({ status: 'trusted', reasons: [], valid_for_hours: 24 });
    expect(inserted[0]).toMatchObject({ user_id: 'u1', status: 'trusted', app_version: '1.0' });
    expect(inserted[0].nonce_hash).toHaveLength(64);
    expect(alerts.alert).not.toHaveBeenCalled();
  });

  it('records an untrusted device with the reasons and alerts the admins (warn/enforce, not off)', async () => {
    const { service, inserted, alerts } = setup({ DEVICE_INTEGRITY_MODE: 'warn' });
    const nonce = service.issueNonce('u1', NOW);
    jest.spyOn(service as any, 'decode').mockResolvedValue(goodPayload(nonce, { deviceIntegrity: { deviceRecognitionVerdict: [] } }));
    const res = await service.verify('u1', { token: 't', signals: ['su_binary', 'test_keys'], rooted: true }, NOW);
    expect(res.status).toBe('untrusted');
    expect(res.reasons).toEqual(expect.arrayContaining(['device_not_certified', 'client_reports_root']));
    expect(inserted[0].client_signals).toEqual(['su_binary', 'test_keys']);
    expect(alerts.alert).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning', dedupeKey: 'device-untrusted:u1' }));

    const quiet = setup({ DEVICE_INTEGRITY_MODE: 'off' });
    const n2 = quiet.service.issueNonce('u1', NOW);
    jest.spyOn(quiet.service as any, 'decode').mockResolvedValue(goodPayload(n2, { deviceIntegrity: {} }));
    await quiet.service.verify('u1', { token: 't' }, NOW);
    expect(quiet.alerts.alert).not.toHaveBeenCalled();
  });

  it('a verdict made for a challenge we did not give this user is untrusted (replayed / borrowed token)', async () => {
    const { service } = setup();
    jest.spyOn(service as any, 'decode').mockResolvedValue(goodPayload(service.issueNonce('someone-else', NOW)));
    expect(await service.verify('u1', { token: 't' }, NOW)).toMatchObject({ status: 'untrusted', reasons: ['nonce_invalid'] });
  });

  it('the same challenge cannot be used twice', async () => {
    const { service } = setup({}, { insertError: 'duplicate key value violates unique constraint' });
    jest.spyOn(service as any, 'decode').mockResolvedValue(goodPayload(service.issueNonce('u1', NOW)));
    await expect(service.verify('u1', { token: 't' }, NOW)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('when Google cannot be asked, nothing is concluded about the device (503, nothing recorded)', async () => {
    const { service, inserted } = setup();
    global.fetch = jest.fn(async () => { throw new Error('network'); }) as any;
    jest.spyOn((service as any).googleAuth(), 'accessToken').mockResolvedValue('tok');
    await expect(service.verify('u1', { token: 't' }, NOW)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(inserted).toHaveLength(0);
    const unconfigured = setup({ PLAY_INTEGRITY_CLIENT_EMAIL: '', PLAY_INTEGRITY_PRIVATE_KEY: '' });
    await expect(unconfigured.service.verify('u1', { token: 't' }, NOW)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('money-out rule (assertMoneyOutAllowed / guard)', () => {
  const fresh = (status: string, ageMs = 60_000) => ({ status, created_at: new Date(NOW - ageMs).toISOString() });
  const android = { active_client_platform: 'android-app' };

  it('off and warn never block, even for an untrusted Android device', async () => {
    for (const mode of ['off', 'warn']) {
      const { service } = setup({ DEVICE_INTEGRITY_MODE: mode }, { profile: android, attestation: fresh('untrusted') });
      await expect(service.assertMoneyOutAllowed('u1', 'android-app', NOW)).resolves.toBeUndefined();
    }
  });

  it('enforce: a recent trusted verdict lets the Android app move money', async () => {
    const { service } = setup({ DEVICE_INTEGRITY_MODE: 'enforce' }, { profile: android, attestation: fresh('trusted') });
    await expect(service.assertMoneyOutAllowed('u1', 'android-app', NOW)).resolves.toBeUndefined();
  });

  it('enforce: no verdict, or a stale one → DEVICE_INTEGRITY_REQUIRED (the app re-attests and retries)', async () => {
    for (const attestation of [null, fresh('trusted', 25 * 3_600_000)]) {
      const { service } = setup({ DEVICE_INTEGRITY_MODE: 'enforce' }, { profile: android, attestation });
      const err: any = await service.assertMoneyOutAllowed('u1', 'android-app', NOW).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse().code).toBe('DEVICE_INTEGRITY_REQUIRED');
    }
  });

  it('enforce: an untrusted device (rooted, emulated, repackaged) → DEVICE_UNTRUSTED', async () => {
    const { service } = setup({ DEVICE_INTEGRITY_MODE: 'enforce' }, { profile: android, attestation: fresh('untrusted') });
    const err: any = await service.assertMoneyOutAllowed('u1', 'android-app', NOW).catch((e) => e);
    expect(err.getResponse().code).toBe('DEVICE_UNTRUSTED');
  });

  it('enforce: a token minted in the Android app stays an Android session even if replayed without the header', async () => {
    const { service } = setup({ DEVICE_INTEGRITY_MODE: 'enforce' }, { profile: android, attestation: null });
    await expect(service.assertMoneyOutAllowed('u1', undefined, NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('enforce: web / desktop sessions are not subject to it', async () => {
    const { service } = setup({ DEVICE_INTEGRITY_MODE: 'enforce' }, { profile: { active_client_platform: 'web' }, attestation: null });
    await expect(service.assertMoneyOutAllowed('u1', undefined, NOW)).resolves.toBeUndefined();
  });

  it('enforce: unreadable tables (migration 054 missing) never freeze payments', async () => {
    const { service } = setup({ DEVICE_INTEGRITY_MODE: 'enforce' }, { profile: android, attestationError: true });
    await expect(service.assertMoneyOutAllowed('u1', 'android-app', NOW)).resolves.toBeUndefined();
  });

  it('the guard skips administrators and passes the platform header', async () => {
    const integrity = { assertMoneyOutAllowed: jest.fn(async () => undefined) };
    const guard = new DeviceIntegrityGuard(integrity as any);
    const ctx = (user: any) => ({ switchToHttp: () => ({ getRequest: () => ({ user, headers: { 'x-client-platform': 'android-app' } }) }) }) as any;
    await guard.canActivate(ctx({ id: 'a', role: 'super_admin' }));
    expect(integrity.assertMoneyOutAllowed).not.toHaveBeenCalled();
    await guard.canActivate(ctx({ id: 'u1', role: 'client' }));
    expect(integrity.assertMoneyOutAllowed).toHaveBeenCalledWith('u1', 'android-app');
  });

  it('only known platforms are ever stored', () => {
    expect(cleanPlatform('android-app')).toBe('android-app');
    expect(cleanPlatform('<script>')).toBeNull();
    expect(cleanPlatform(undefined)).toBeNull();
  });
});

describe('GoogleServiceAuth', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });

  it('signs a verifiable RS256 assertion for the right account, scope and audience', () => {
    const auth = new GoogleServiceAuth('sa@p.iam.gserviceaccount.com', privateKey.replace(/\n/g, '\\n'), 'scope-x');
    const [h, c, sig] = auth.assertion(1_700_000_000_000).split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(c, 'base64url').toString())).toEqual({ iss: 'sa@p.iam.gserviceaccount.com', scope: 'scope-x', aud: 'https://oauth2.googleapis.com/token', iat: 1_700_000_000, exp: 1_700_003_600 });
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(createPublicKey(publicKey), Buffer.from(sig, 'base64url'))).toBe(true);
  });

  it('caches the access token until shortly before it expires', async () => {
    const fetchFn = jest.fn(async () => ({ ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) })) as any;
    const auth = new GoogleServiceAuth('sa@p', privateKey, 's', fetchFn);
    expect(await auth.accessToken(1_000)).toBe('tok');
    expect(await auth.accessToken(1_000 + 60_000)).toBe('tok');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await auth.accessToken(1_000 + 3_600_000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    fetchFn.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(new GoogleServiceAuth('sa@p', privateKey, 's', fetchFn).accessToken()).rejects.toThrow(/401/);
  });
});
