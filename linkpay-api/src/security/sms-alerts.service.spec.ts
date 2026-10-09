import { SmsAlertsService, normalizePhone, toSmsText } from './sms-alerts.service';

const config = (env: Record<string, string>) => ({ get: (k: string) => env[k] }) as any;
const AT = { SMS_PROVIDER: 'africastalking', AT_USERNAME: 'scanlinkpay', AT_API_KEY: 'key', AT_SENDER_ID: 'SLP' };
const TW = { SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'ACxyz', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+15550001' };

describe('normalizePhone / toSmsText', () => {
  it('accepts only full international numbers', () => {
    expect(normalizePhone('+243 812-345-678')).toBe('+243812345678');
    expect(normalizePhone('00243812345678')).toBe('+243812345678');
    expect(normalizePhone('0812345678')).toBeNull();
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it('keeps an SMS in one plain-ASCII segment', () => {
    expect(toSmsText('Alerte: portefeuille négatif 🚨 d’un client')).toBe("Alerte: portefeuille negatif d'un client");
    const long = toSmsText('x'.repeat(400));
    expect(long).toHaveLength(160);
    expect(long.endsWith('...')).toBe(true);
  });
});

describe('SmsAlertsService', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  beforeEach(() => { fetchMock = jest.fn(async () => ({ ok: true, status: 200, text: async () => '' })); (global as any).fetch = fetchMock; });
  afterAll(() => { global.fetch = realFetch; });

  it('does nothing until a provider is fully configured', async () => {
    for (const env of <Record<string, string>[]>[{}, { SMS_PROVIDER: 'africastalking' }, { SMS_PROVIDER: 'twilio', TWILIO_ACCOUNT_SID: 'x' }, { SMS_PROVIDER: 'unknown' }]) {
      const s = new SmsAlertsService(config(env));
      expect(s.enabled).toBe(false);
      expect(await s.send(['+243812345678'], 'x')).toBe(0);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Africa's Talking: one request for all numbers, key in the header, plain text", async () => {
    const s = new SmsAlertsService(config(AT));
    expect(await s.send(['+243812345678', '0812345678', '+243900000000', '+243812345678'], 'ALERTE é')).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.africastalking.com/version1/messaging');
    expect(init.headers.apiKey).toBe('key');
    const body = new URLSearchParams(init.body);
    expect(body.get('to')).toBe('+243812345678,+243900000000');
    expect(body.get('message')).toBe('ALERTE e');
    expect(body.get('from')).toBe('SLP');
  });

  it("Africa's Talking sandbox username uses the sandbox host", async () => {
    await new SmsAlertsService(config({ ...AT, AT_USERNAME: 'sandbox' })).send(['+243812345678'], 'x');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.sandbox.africastalking.com/version1/messaging');
  });

  it('Twilio: one request per number, basic auth', async () => {
    const s = new SmsAlertsService(config(TW));
    expect(await s.send(['+243812345678', '+243900000000'], 'x')).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACxyz/Messages.json');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('ACxyz:tok').toString('base64')}`);
    expect(new URLSearchParams(init.body).get('To')).toBe('+243812345678');
  });

  it('never throws: a refusal, a timeout or a network error just returns 0', async () => {
    const s = new SmsAlertsService(config(AT));
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'bad key' });
    expect(await s.send(['+243812345678'], 'x', 1)).toBe(0);
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    expect(await s.send(['+243812345678'], 'x', 2)).toBe(0);
  });

  it('has a spending brake: at most SMS_MAX_PER_HOUR per hour, then again after the hour', async () => {
    const s = new SmsAlertsService(config({ ...AT, SMS_MAX_PER_HOUR: '3' }));
    const t = 1_000_000;
    expect(await s.send(['+243812345678', '+243900000001'], 'a', t)).toBe(2);
    expect(await s.send(['+243812345678', '+243900000001'], 'b', t + 1)).toBe(0); // 2 + 2 > 3
    expect(await s.send(['+243812345678'], 'c', t + 2)).toBe(1);
    expect(await s.send(['+243812345678'], 'd', t + 3)).toBe(0);
    expect(await s.send(['+243812345678'], 'e', t + 3_600_001)).toBe(1);
  });
});
