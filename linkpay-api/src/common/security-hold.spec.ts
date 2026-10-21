import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { assertNoRecentSecurityChange, SECURITY_HOLD_MS } from './security-hold';
import { createFakeSupabase } from '../test-utils/fake-supabase';

const client = (answer: any) => createFakeSupabase(() => answer).service.getClient();
const NOW = Date.parse('2026-10-21T12:00:00Z');

describe('24 h hold after a change of password, PIN, phone or email', () => {
  it('no change recorded, or the change is older than 24 h: money may leave', async () => {
    await expect(assertNoRecentSecurityChange(client({ data: { security_changed_at: null } }), 'u1', NOW)).resolves.toBeUndefined();
    await expect(assertNoRecentSecurityChange(client({ data: null }), 'u1', NOW)).resolves.toBeUndefined();
    const old = new Date(NOW - SECURITY_HOLD_MS - 1).toISOString();
    await expect(assertNoRecentSecurityChange(client({ data: { security_changed_at: old } }), 'u1', NOW)).resolves.toBeUndefined();
  });

  it('changed less than 24 h ago: refused, saying until when (local time)', async () => {
    const recent = new Date(NOW - 3_600_000).toISOString(); // 11:00 UTC = 13:00 Lubumbashi
    const e = await assertNoRecentSecurityChange(client({ data: { security_changed_at: recent } }), 'u1', NOW).catch((x) => x);
    expect(e).toBeInstanceOf(ForbiddenException);
    expect(e.message).toContain('22/10');
    expect(e.message).toContain('13:00');
  });

  it('cannot read: refused (never let through unchecked)', async () => {
    await expect(assertNoRecentSecurityChange(client({ error: { message: 'timeout' } }), 'u1', NOW)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('migration 068 not applied yet: not enforced, the API keeps working', async () => {
    await expect(assertNoRecentSecurityChange(client({ error: { message: 'column profiles.security_changed_at does not exist' } }), 'u1', NOW)).resolves.toBeUndefined();
  });
});
