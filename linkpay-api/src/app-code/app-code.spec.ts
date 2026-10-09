import * as bcrypt from 'bcryptjs';
import { createHmac, createHash } from 'crypto';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';
import { LoginAttemptsService } from '../auth/login-attempts.service';
import { AppCodeService } from './app-code.service';
import { weakAppCodeReason } from './code-strength';

const config = { get: (k: string) => (k === 'JWT_SECRET' ? 'j'.repeat(48) : undefined) } as any;
const pepper = (code: string) =>
  createHmac('sha256', createHash('sha256').update(`app-code:${'j'.repeat(48)}`).digest('hex')).update(code).digest('base64');

describe('weakAppCodeReason', () => {
  it.each(['123456', '654321', '000000', '111111', '121212', '123123', '112233', '010203', '120199', '555566', '234567', '987654'])('refuses %s', (c) => {
    expect(weakAppCodeReason(c)).not.toBeNull();
  });
  it.each(['482915', '739208', '951764', '845120'])('accepts %s', (c) => {
    expect(weakAppCodeReason(c)).toBeNull();
  });
  it('refuses anything that is not exactly 6 digits', () => {
    for (const c of ['12345', '1234567', 'abcdef', '12 456', '']) expect(weakAppCodeReason(c)).not.toBeNull();
  });
});

function setup(opts: { hash?: string | null; txPinHash?: string | null; begin?: any; fail?: any; passwordOk?: boolean } = {}) {
  const updates: any[] = [];
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'profiles') {
      if (q.calls.some((c) => c.method === 'update')) { updates.push(q.calls.find((c) => c.method === 'update')!.args[0]); return { data: null }; }
      return { data: { email: 'u@x.com', app_code_hash: opts.hash ?? null, transaction_pin_hash: opts.txPinHash ?? null } };
    }
    if (q.target === 'rpc:begin_app_code_attempt') return { data: [opts.begin ?? { status: 'ok', attempts: 1, locked_until: null }] };
    if (q.target === 'rpc:fail_app_code_attempt') return { data: [opts.fail ?? { status: 'ok', attempts: 1, locked_until: null }] };
    return { data: null };
  });
  (fake.service as any).getAuthClient = () => ({ auth: { signInWithPassword: async () => ({ error: opts.passwordOk === false ? { message: 'bad' } : null }) } });
  const notifications = { create: jest.fn(async () => undefined) };
  const service = new AppCodeService(fake.service, notifications as any, new LoginAttemptsService(), config);
  return { service, fake, updates, notifications };
}

describe('AppCodeService', () => {
  it('creates a code: stores a salted+peppered hash, never the digits', async () => {
    const { service, updates } = setup();
    await service.create('u1', '482915', '482915');
    const stored = updates.find((u) => u.app_code_hash)!.app_code_hash;
    expect(stored).not.toContain('482915');
    expect(await bcrypt.compare(pepper('482915'), stored)).toBe(true);
    expect(await bcrypt.compare('482915', stored)).toBe(false); // a leaked DB alone can't be matched against raw digits
  });

  it('refuses mismatched, weak, or already-existing codes (and never reveals whether a code equals the transaction PIN)', async () => {
    await expect(setup().service.create('u1', '482915', '482916')).rejects.toThrow(/pas identiques/);
    await expect(setup().service.create('u1', '123456', '123456')).rejects.toThrow(/courant/);
    await expect(setup({ hash: 'x' }).service.create('u1', '482915', '482915')).rejects.toThrow(/existe déjà/);
    const txPinHash = await bcrypt.hash('482915', 4);
    // Deliberately allowed: answering differently when the code equals the PIN would be an oracle for guessing the PIN.
    await expect(setup({ txPinHash }).service.create('u1', '482915', '482915')).resolves.toBeUndefined();
  });

  it('verifies the right code, and clears the failure counter', async () => {
    const hash = await bcrypt.hash(pepper('482915'), 4);
    const { service, fake } = setup({ hash });
    await expect(service.verify('u1', '482915')).resolves.toBeUndefined();
    expect(fake.queries.some((q) => q.target === 'rpc:clear_app_code_failures')).toBe(true);
  });

  it('a wrong code reports how many tries are left', async () => {
    const hash = await bcrypt.hash(pepper('482915'), 4);
    const { service } = setup({ hash, fail: { status: 'ok', attempts: 3, locked_until: null } });
    await expect(service.verify('u1', '000001')).rejects.toMatchObject({ response: { code: 'APP_CODE_INVALID', attempts_left: 2 } });
  });

  it('refuses without comparing anything while locked (the guess is counted first)', async () => {
    const { service, fake } = setup({ hash: 'x', begin: { status: 'locked', attempts: 0, locked_until: new Date(Date.now() + 600_000).toISOString() } });
    await expect(service.verify('u1', '482915')).rejects.toMatchObject({ status: 429, response: { code: 'APP_CODE_LOCKED' } });
    expect(fake.queries.filter((q) => q.target === 'profiles')).toHaveLength(0);
  });

  it('ends the session after repeated lock-outs and tells the user', async () => {
    const hash = await bcrypt.hash(pepper('482915'), 4);
    const { service, notifications, updates } = setup({ hash, fail: { status: 'terminate', attempts: 0, locked_until: new Date().toISOString() } });
    await expect(service.verify('u1', '000001')).rejects.toMatchObject({ response: { code: 'SESSION_TERMINATED' } });
    expect(updates).toContainEqual({ active_session_id: null });
    expect(notifications.create).toHaveBeenCalled();
  });

  it('change() needs the current code and a different, acceptable new one', async () => {
    const hash = await bcrypt.hash(pepper('482915'), 4);
    await expect(setup({ hash }).service.change('u1', '482915', '482915', '482915')).rejects.toThrow(/différent de l'ancien/);
    const ok = setup({ hash });
    await expect(ok.service.change('u1', '482915', '739208', '739208')).resolves.toBeUndefined();
    expect(ok.updates.find((u) => u.app_code_hash)).toBeTruthy();
    expect(ok.notifications.create).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('modifié') }));
    await expect(setup({ hash, fail: { status: 'ok', attempts: 1, locked_until: null } }).service.change('u1', '000001', '739208', '739208')).rejects.toMatchObject({ response: { code: 'APP_CODE_INVALID' } });
  });

  it('forgot-code reset needs the account password, then wipes the code', async () => {
    const good = setup({ hash: 'x' });
    await good.service.resetWithPassword('u1', 'MonMotDePasse1!');
    expect(good.updates).toContainEqual({ app_code_hash: null, app_code_set_at: null });
    const bad = setup({ hash: 'x', passwordOk: false });
    await expect(bad.service.resetWithPassword('u1', 'nope')).rejects.toThrow(/Mot de passe incorrect/);
    expect(bad.updates.find((u) => 'app_code_hash' in u)).toBeUndefined();
  });

  it('confirm() checks the code (counted against the lockout) and returns a 5-minute token', async () => {
    const hash = await bcrypt.hash(pepper('482915'), 4);
    const { service } = setup({ hash });
    const r = await service.confirm('u1', '482915');
    expect(r.expires_in).toBe(300);
    expect(r.confirmation_token).toContain('.');
    const wrong = setup({ hash, fail: { status: 'ok', attempts: 1, locked_until: null } });
    await expect(wrong.service.confirm('u1', '000001')).rejects.toMatchObject({ response: { code: 'APP_CODE_INVALID' } });
    await expect(setup().service.confirm('u1', '482915')).rejects.toThrow(/Créez d'abord/);
  });
});
