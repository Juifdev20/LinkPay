import { BadRequestException } from '@nestjs/common';
import { FlexPaieAdapter, mapFlexPaieStatus, toFlexPaieMsisdn } from './flexpaie.adapter';
import { PayoutNotSentError } from '../psp.adapter';
import { createFakeSupabase, has, RecordedQuery } from '../../../test-utils/fake-supabase';

const TOKEN = 'sekret-token-123';
const CONFIG: Record<string, string> = { FLEXPAIE_BASE_URL: 'https://pay.flexpay.test:8443/', FLEXPAIE_MERCHANT: 'SCANLINK', FLEXPAIE_TOKEN: TOKEN };

function setup(opts: { recorded?: string | null; insertError?: boolean; config?: Record<string, string> } = {}) {
  const fake = createFakeSupabase((q: RecordedQuery) => {
    if (q.target === 'flexpaie_orders') {
      if (has(q, 'insert')) return opts.insertError ? { error: { message: 'relation "flexpaie_orders" does not exist' } } : { data: null };
      return { data: opts.recorded === undefined ? { order_number: 'ORD-1' } : opts.recorded ? { order_number: opts.recorded } : null };
    }
    return { data: null };
  });
  const adapter = new FlexPaieAdapter({ get: (k: string, d?: any) => (opts.config ?? CONFIG)[k] ?? d } as any, fake.service);
  return { adapter, fake };
}

const reply = (body: any, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as any;
const realFetch = (global as any).fetch; // before any test replaces it
let fetchMock: jest.Mock;
beforeEach(() => { fetchMock = jest.fn(); (global as any).fetch = fetchMock; });
const sentBody = (i = 0) => JSON.parse(fetchMock.mock.calls[i][1].body);

const BASE = { amount_cents: 500000, currency: 'CDF', reference: 'TOPUP-20261009-AB12CD', redirect_url: 'https://app.example/dashboard/wallet/topup/result?ref=TOPUP-20261009-AB12CD', webhook_url: 'https://api.example/api/v1/webhooks/flexpaie' };

describe('phone numbers', () => {
  it.each([['+243 89 123 45 67'], ['0891234567'], ['243891234567'], ['891234567'], ['00243891234567']])('%s → 243891234567', (input) => {
    expect(toFlexPaieMsisdn(input)).toBe('243891234567');
  });
  it.each([[''], ['abc'], ['+33612345678'], ['24389123'], [undefined]])('refuses %p', (input) => {
    expect(() => toFlexPaieMsisdn(input as any)).toThrow(BadRequestException);
  });
});

describe('status codes of the documentation', () => {
  it('0 paid, 2 waiting, 1/3/4/5 not paid, anything unknown keeps waiting (never a verdict)', () => {
    expect(mapFlexPaieStatus('0')).toBe('SUCCESS');
    expect(mapFlexPaieStatus(0)).toBe('SUCCESS');
    expect(mapFlexPaieStatus('2')).toBe('PENDING');
    for (const c of ['1', '3', '4', '5']) expect(mapFlexPaieStatus(c)).toBe('FAILED');
    for (const c of ['7', '', undefined, null, 'ok']) expect(mapFlexPaieStatus(c)).toBe('PENDING');
  });
});

describe('Mobile Money payment (type 1)', () => {
  it('sends the documented request and returns OUR reference, with our own result page to wait on', async () => {
    const { adapter, fake } = setup();
    fetchMock.mockResolvedValue(reply({ code: '0', message: 'ok', orderNumber: 'ORD-1' }));
    const r = await adapter.createPaymentIntent({ ...BASE, customer: { phone: '+243 89 123 45 67' }, metadata: { payment_method: 'mobile_money' } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://pay.flexpay.test:8443/api/rest/v1/paymentService');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(sentBody()).toEqual({ merchant: 'SCANLINK', type: '1', phone: '243891234567', reference: BASE.reference, amount: '5000', currency: 'CDF', callback_url: BASE.webhook_url });
    expect(r).toEqual({ psp_intent_id: BASE.reference, checkout_url: BASE.redirect_url, status: 'PENDING' });
    expect(fake.queries.find((q) => has(q, 'insert'))!.calls.find((c) => c.method === 'insert')!.args[0]).toEqual({ reference: BASE.reference, order_number: 'ORD-1' });
  });

  it('accepts a token that already starts with "Bearer"', async () => {
    const { adapter } = setup();
    CONFIG.FLEXPAIE_TOKEN = `Bearer ${TOKEN}`;
    fetchMock.mockResolvedValue(reply({ code: '0', orderNumber: 'ORD-1' }));
    await adapter.createPaymentIntent({ ...BASE, customer: { phone: '0891234567' } });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    CONFIG.FLEXPAIE_TOKEN = TOKEN;
  });

  it('refuses before calling FlexPaie: no phone, a fraction of a unit', async () => {
    const { adapter } = setup();
    await expect(adapter.createPaymentIntent({ ...BASE, customer: {} })).rejects.toBeInstanceOf(BadRequestException);
    await expect(adapter.createPaymentIntent({ ...BASE, amount_cents: 1050, customer: { phone: '0891234567' } })).rejects.toThrow(/entiers/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a refusal by FlexPaie (code 1) is an error, and nothing is recorded', async () => {
    const { adapter, fake } = setup();
    fetchMock.mockResolvedValue(reply({ code: '1', message: 'Solde marchand insuffisant' }));
    await expect(adapter.createPaymentIntent({ ...BASE, customer: { phone: '0891234567' } })).rejects.toThrow(/refused the payment: Solde marchand insuffisant/);
    expect(fake.queries.some((q) => has(q, 'insert'))).toBe(false);
  });

  it('fails loudly when the order number cannot be recorded (a payment that could never be verified)', async () => {
    const { adapter, fake } = setup({ insertError: true });
    fetchMock.mockResolvedValue(reply({ code: '0', orderNumber: 'ORD-1' }));
    await expect(adapter.createPaymentIntent({ ...BASE, customer: { phone: '0891234567' } })).rejects.toThrow(/record the FlexPaie order number/);
    expect(fake.queries.filter((q) => has(q, 'insert'))).toHaveLength(3);
  });

  it('401 reads as an authentication problem, and the token never appears in an error', async () => {
    const { adapter } = setup();
    fetchMock.mockResolvedValue(reply({}, 401));
    const err: any = await adapter.createPaymentIntent({ ...BASE, customer: { phone: '0891234567' } }).catch((e) => e);
    expect(err.message).toContain('Authentication failed');
    expect(err.message).not.toContain(TOKEN);
  });

  it('is clear when it is not configured', async () => {
    const adapter = new FlexPaieAdapter({ get: (_k: string, d?: any) => d } as any, setup().fake.service);
    await expect(adapter.createPaymentIntent({ ...BASE, customer: { phone: '0891234567' } })).rejects.toThrow(/not configured/);
  });
});

describe('production addresses: Mobile Money, card and status check on three different hosts', () => {
  const PROD = { FLEXPAIE_MOMO_URL: 'https://momo.flex.test/api/rest/v1/paymentService', FLEXPAIE_CARD_URL: 'https://cards.flex.test/api/rest/v1/paymentService/', FLEXPAIE_CHECK_URL: 'https://apicheck.flex.test/api/rest/v1/check/ORDER_NUMBER_A_REMPLACER', FLEXPAIE_MERCHANT: 'SCANLINK', FLEXPAIE_TOKEN: TOKEN };

  it('Mobile Money goes to its address, card to its own, status check to the third (the e-mail placeholder is dropped)', async () => {
    const { adapter } = setup({ config: PROD, recorded: 'ORD-7' });
    fetchMock.mockResolvedValueOnce(reply({ code: '0', orderNumber: 'ORD-1' }));
    await adapter.createPaymentIntent({ ...BASE, customer: { phone: '0891234567' }, metadata: { payment_method: 'mobile_money' } });
    expect(fetchMock.mock.calls[0][0]).toBe('https://momo.flex.test/api/rest/v1/paymentService');
    fetchMock.mockResolvedValueOnce(reply({ code: '0', orderNumber: 'ORD-2', url: 'https://pay.bank.test/x' }));
    await adapter.createPaymentIntent({ ...BASE, metadata: { payment_method: 'card' } });
    expect(fetchMock.mock.calls[1][0]).toBe('https://cards.flex.test/api/rest/v1/paymentService');
    fetchMock.mockResolvedValueOnce(reply({ code: '0', transaction: { reference: BASE.reference, amount: '5000', currency: 'CDF', status: '0' } }));
    await adapter.getTransactionStatus(BASE.reference);
    expect(fetchMock.mock.calls[2][0]).toBe('https://apicheck.flex.test/api/rest/v1/check/ORD-7');
  });

  it('an address that is not given falls back on FLEXPAIE_BASE_URL', async () => {
    const { adapter } = setup({ config: { ...CONFIG, FLEXPAIE_CHECK_URL: 'https://apicheck.flex.test/api/rest/v1/check' }, recorded: 'ORD-7' });
    fetchMock.mockResolvedValueOnce(reply({ code: '0', orderNumber: 'ORD-1' }));
    await adapter.createPaymentIntent({ ...BASE, customer: { phone: '0891234567' }, metadata: { payment_method: 'mobile_money' } });
    expect(fetchMock.mock.calls[0][0]).toBe('https://pay.flexpay.test:8443/api/rest/v1/paymentService');
    fetchMock.mockResolvedValueOnce(reply({ code: '0', transaction: { reference: BASE.reference, amount: '5000', currency: 'CDF', status: '0' } }));
    await adapter.getTransactionStatus(BASE.reference);
    expect(fetchMock.mock.calls[1][0]).toBe('https://apicheck.flex.test/api/rest/v1/check/ORD-7');
  });

  it('with only the Mobile Money address, a card payment says it is not configured (nothing is sent)', async () => {
    const { adapter } = setup({ config: { FLEXPAIE_MOMO_URL: PROD.FLEXPAIE_MOMO_URL, FLEXPAIE_MERCHANT: 'S', FLEXPAIE_TOKEN: TOKEN } });
    await expect(adapter.createPaymentIntent({ ...BASE, metadata: { payment_method: 'card' } })).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('card payment (type 2)', () => {
  const card = { ...BASE, metadata: { payment_method: 'card' } };
  it('sends the three return pages and goes to the page FlexPaie gives', async () => {
    const { adapter } = setup();
    fetchMock.mockResolvedValue(reply({ code: '0', orderNumber: 'ORD-1', url: 'https://gwvisa.flexpay.cd/ORD-1' }));
    const r = await adapter.createPaymentIntent(card);
    expect(sentBody()).toEqual({ merchant: 'SCANLINK', type: '2', reference: BASE.reference, amount: '5000', currency: 'CDF', callback_url: BASE.webhook_url, approve_url: BASE.redirect_url, cancel_url: BASE.redirect_url, decline_url: BASE.redirect_url });
    expect(r.checkout_url).toBe('https://gwvisa.flexpay.cd/ORD-1');
  });
  it('never sends the customer to a page that is not https', async () => {
    const { adapter } = setup();
    for (const url of ['http://gwvisa.flexpay.cd/x', 'javascript:alert(1)', undefined]) {
      fetchMock.mockResolvedValue(reply({ code: '0', orderNumber: 'ORD-1', url }));
      await expect(adapter.createPaymentIntent(card)).rejects.toThrow(/usable card payment page/);
    }
  });
});

describe('asking FlexPaie about a payment', () => {
  const transaction = (over: any = {}) => ({ code: '0', transaction: { reference: BASE.reference, amount: '5000.0', amountCustomer: '5100.0', currency: 'CDF', status: '0', ...over } });

  it('reads it with the order number recorded for our reference, and gives the amount WITHOUT the customer fee', async () => {
    const { adapter } = setup({ recorded: 'ORD-9' });
    fetchMock.mockResolvedValue(reply(transaction()));
    expect(await adapter.getTransactionStatus(BASE.reference)).toEqual({ status: 'SUCCESS', amount_cents: 500000, currency: 'CDF' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://pay.flexpay.test:8443/api/rest/v1/check/ORD-9');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
  });
  it.each([['1', 'FAILED'], ['2', 'PENDING'], ['3', 'FAILED'], ['4', 'FAILED'], ['5', 'FAILED']])('status %s → %s', async (code, expected) => {
    const { adapter } = setup();
    fetchMock.mockResolvedValue(reply(transaction({ status: code })));
    expect((await adapter.getTransactionStatus(BASE.reference)).status).toBe(expected);
  });
  it('keeps waiting — never fails — when nothing is recorded, FlexPaie knows no order, or it cannot be reached', async () => {
    expect((await setup({ recorded: null }).adapter.getTransactionStatus('X')).status).toBe('PENDING');
    expect(fetchMock).not.toHaveBeenCalled();
    const { adapter } = setup();
    fetchMock.mockResolvedValue(reply({ code: '1', message: 'Aucune transaction trouvée', transaction: null }));
    expect((await adapter.getTransactionStatus(BASE.reference)).status).toBe('PENDING');
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    expect((await adapter.getTransactionStatus(BASE.reference)).status).toBe('PENDING');
    fetchMock.mockResolvedValue(reply({}, 500));
    expect((await adapter.getTransactionStatus(BASE.reference)).status).toBe('PENDING');
  });
});

describe('the callback (no signature: only a hint)', () => {
  const cb = (over: any = {}) => Buffer.from(JSON.stringify({ code: '0', reference: BASE.reference, orderNumber: 'ORD-1', amount: '5000', currency: 'CDF', ...over }));
  const checked = (over: any = {}) => reply({ code: '0', transaction: { reference: BASE.reference, amount: '5000.0', currency: 'CDF', status: '0', ...over } });

  it('has to be shaped like a callback', () => {
    const { adapter } = setup();
    expect(adapter.verifyWebhook(cb(), '', {})).toBe(true);
    expect(adapter.verifyWebhook(Buffer.from('{}'), '', {})).toBe(false);
    expect(adapter.verifyWebhook(Buffer.from('not json'), '', {})).toBe(false);
    expect(adapter.verifyWebhook(Buffer.from(JSON.stringify({ reference: 'x'.repeat(101) })), '', {})).toBe(false);
    expect(adapter.verifyWebhook(Buffer.from(`reference=${BASE.reference}&code=0`), '', {})).toBe(true); // form-encoded
  });

  it('is never believed: the status comes from FlexPaie, with OUR recorded order number', async () => {
    const { adapter } = setup({ recorded: 'ORD-1' });
    fetchMock.mockResolvedValue(checked());
    const e = await adapter.parseWebhookEvent(cb(), {});
    expect(fetchMock.mock.calls[0][0]).toContain('/check/ORD-1');
    expect(e).toMatchObject({ psp_intent_id: BASE.reference, status: 'SUCCESS', amount_cents: 500000, currency: 'CDF', event_id: 'ORD-1:SUCCESS', event_type: 'payment.succeeded' });
  });

  it('a callback that says "paid" while FlexPaie says "failed" is a failure', async () => {
    const { adapter } = setup();
    fetchMock.mockResolvedValue(checked({ status: '1' }));
    expect((await adapter.parseWebhookEvent(cb({ code: '0' }), {})).status).toBe('FAILED');
  });

  it('a callback that says "failed" while FlexPaie says "paid" credits nothing wrong: it is a success only because FlexPaie says so', async () => {
    const { adapter } = setup();
    fetchMock.mockResolvedValue(checked({ status: '0' }));
    expect((await adapter.parseWebhookEvent(cb({ code: '1' }), {})).status).toBe('SUCCESS');
  });

  it('the amount is the one FlexPaie reports, not the one in the callback', async () => {
    const { adapter } = setup();
    fetchMock.mockResolvedValue(checked({ amount: '10.0' }));
    expect((await adapter.parseWebhookEvent(cb({ amount: '5000' }), {})).amount_cents).toBe(1000);
  });

  it("refuses a callback that names another order than the one recorded for this reference (a real payment of 1 FC replayed onto a big invoice)", async () => {
    const { adapter } = setup({ recorded: 'ORD-1' });
    await expect(adapter.parseWebhookEvent(cb({ orderNumber: 'ORD-CHEAP' }), {})).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an order that belongs to another reference, an unknown order, and a callback without reference', async () => {
    const { adapter } = setup();
    fetchMock.mockResolvedValue(checked({ reference: 'SOMEONE-ELSES' }));
    await expect(adapter.parseWebhookEvent(cb(), {})).rejects.toBeInstanceOf(BadRequestException);
    fetchMock.mockResolvedValue(reply({ code: '1', transaction: null }));
    await expect(adapter.parseWebhookEvent(cb(), {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(adapter.parseWebhookEvent(Buffer.from('{}'), {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('when the order number was never recorded, the callback\'s is used — and must still answer with the same reference', async () => {
    const { adapter } = setup({ recorded: null });
    fetchMock.mockResolvedValue(checked());
    expect((await adapter.parseWebhookEvent(cb(), {})).status).toBe('SUCCESS');
    expect(fetchMock.mock.calls[0][0]).toContain('/check/ORD-1');
    fetchMock.mockResolvedValue(checked({ reference: 'OTHER' }));
    await expect(adapter.parseWebhookEvent(cb(), {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ recorded: null }).adapter.parseWebhookEvent(cb({ orderNumber: undefined }), {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('each state is its own event, so "waiting" then "paid" are both processed', async () => {
    const { adapter } = setup({ recorded: 'ORD-1' });
    fetchMock.mockResolvedValueOnce(checked({ status: '2' })).mockResolvedValueOnce(checked({ status: '0' }));
    const a = await adapter.parseWebhookEvent(cb(), {});
    const b = await adapter.parseWebhookEvent(cb(), {});
    expect(a.event_id).not.toBe(b.event_id);
  });
});

describe('what FlexPaie does not document', () => {
  it('no automatic withdrawal is attempted, and it is said so; no automatic refund either', async () => {
    const { adapter } = setup();
    await expect(adapter.payout({ reference: 'w1', amount_cents: 100, currency: 'CDF', channel: 'mobile_money', destination: {} })).rejects.toBeInstanceOf(PayoutNotSentError);
    expect(await adapter.getPayoutStatus('w1')).toEqual({ status: 'NOT_FOUND' });
    await expect(adapter.refund({ psp_intent_id: 'x', amount_cents: 100 })).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Real HTTP, no fetch mock: a small server plays FlexPaie, exactly as the documentation describes it.
// ---------------------------------------------------------------------------------------------------------------------
import * as http from 'http';

describe('against a local FlexPaie double (real network calls)', () => {
  let server: http.Server;
  let base = '';
  const seen: { method?: string; url?: string; auth?: string; ctype?: string; body?: any }[] = [];
  const orders = new Map<string, any>();

  beforeEach(() => { (global as any).fetch = realFetch; });

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, ctype: String(req.headers['content-type']), body: raw ? JSON.parse(raw) : undefined });
        const send = (code: number, body: any) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
        if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { code: '1', message: 'Unauthorized' });
        if (req.method === 'POST' && req.url === '/api/rest/v1/paymentService') {
          const b = JSON.parse(raw);
          const orderNumber = `ORD${orders.size + 1}`;
          orders.set(orderNumber, { reference: b.reference, amount: `${b.amount}.0`, amountCustomer: `${Number(b.amount) + 2}.0`, currency: b.currency, createdAt: '09-10-2026 10:00:00', status: '2', channel: b.type === '2' ? 'visa' : 'mpesa' });
          return send(200, { code: '0', message: 'Transaction envoyée avec succès. Veuillez valider le push message', orderNumber, ...(b.type === '2' ? { url: `https://gwvisa.flexpay.cd/${orderNumber}` } : {}) });
        }
        const m = /^\/api\/rest\/v1\/check\/(.+)$/.exec(req.url || '');
        if (req.method === 'GET' && m) {
          const t = orders.get(decodeURIComponent(m[1]));
          return send(200, t ? { code: '0', message: 'Une transaction a été trouvée', transaction: t } : { code: '1', message: 'Aucune transaction trouvée', transaction: null });
        }
        send(404, {});
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('a Mobile Money payment from request to confirmation', async () => {
    const stored = new Map<string, string>();
    const db: any = {
      getClient: () => ({
        from: () => ({
          insert: async (row: any) => { stored.set(row.reference, row.order_number); return { error: null }; },
          select: () => ({ eq: (_c: string, ref: string) => ({ maybeSingle: async () => ({ data: stored.has(ref) ? { order_number: stored.get(ref) } : null }) }) }),
        }),
      }),
    };
    const adapter = new FlexPaieAdapter({ get: (k: string, d?: any) => ({ ...CONFIG, FLEXPAIE_BASE_URL: base })[k] ?? d } as any, db);

    const created = await adapter.createPaymentIntent({ ...BASE, customer: { phone: '+243 89 123 45 67' } });
    expect(created.psp_intent_id).toBe(BASE.reference);
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/rest/v1/paymentService', auth: `Bearer ${TOKEN}`, ctype: 'application/json' });
    expect(seen[0].body).toMatchObject({ merchant: 'SCANLINK', type: '1', phone: '243891234567', amount: '5000', currency: 'CDF' });

    // the customer has not validated yet
    expect((await adapter.getTransactionStatus(BASE.reference)).status).toBe('PENDING');
    expect(seen[1]).toMatchObject({ method: 'GET', url: '/api/rest/v1/check/ORD1', auth: `Bearer ${TOKEN}` });

    // ...then pays: FlexPaie says so, the callback only says which payment to look at
    orders.get('ORD1').status = '0';
    expect(await adapter.getTransactionStatus(BASE.reference)).toEqual({ status: 'SUCCESS', amount_cents: 500000, currency: 'CDF' });
    const callback = Buffer.from(JSON.stringify({ code: '0', reference: BASE.reference, orderNumber: 'ORD1', amount: '5000', amountCustomer: '5002', currency: 'CDF', channel: 'mpesa' }));
    expect(adapter.verifyWebhook(callback, '', {})).toBe(true);
    expect(await adapter.parseWebhookEvent(callback, {})).toMatchObject({ status: 'SUCCESS', psp_intent_id: BASE.reference, amount_cents: 500000 });
  });

  it('a bank card payment: the provider page, the three ways back, and what is credited', async () => {
    const stored = new Map<string, string>();
    const db: any = {
      getClient: () => ({
        from: () => ({
          insert: async (row: any) => { stored.set(row.reference, row.order_number); return { error: null }; },
          select: () => ({ eq: (_c: string, ref: string) => ({ maybeSingle: async () => ({ data: stored.has(ref) ? { order_number: stored.get(ref) } : null }) }) }),
        }),
      }),
    };
    const adapter = new FlexPaieAdapter({ get: (k: string, d?: any) => ({ ...CONFIG, FLEXPAIE_BASE_URL: base })[k] ?? d } as any, db);
    const cardRef = (n: number) => `TOPUP-20261010-CARD0${n}`;
    const RETURN = 'https://app.example/payment/return?to=topup&ref=';

    const created = await adapter.createPaymentIntent({ ...BASE, reference: cardRef(1), redirect_url: `${RETURN}${cardRef(1)}`, metadata: { payment_method: 'card' } });
    const sent = seen[seen.length - 1];
    // type 2, no phone, and whatever the outcome the customer comes back to the SAME neutral page
    expect(sent.body).toMatchObject({ merchant: 'SCANLINK', type: '2', amount: '5000', currency: 'CDF', approve_url: `${RETURN}${cardRef(1)}`, cancel_url: `${RETURN}${cardRef(1)}`, decline_url: `${RETURN}${cardRef(1)}` });
    expect(sent.body.phone).toBeUndefined();
    expect(created.checkout_url).toMatch(/^https:\/\/gwvisa\.flexpay\.cd\/ORD\d+$/);
    expect(created.psp_intent_id).toBe(cardRef(1));

    // left on the bank page: still waiting
    expect((await adapter.getTransactionStatus(cardRef(1))).status).toBe('PENDING');
    // paid: credited the amount WITHOUT the customer's fee
    const order = [...orders.values()].find((o: any) => o.reference === cardRef(1));
    order.status = '0';
    expect(await adapter.getTransactionStatus(cardRef(1))).toEqual({ status: 'SUCCESS', amount_cents: 500000, currency: 'CDF' });

    // cancelled / declined / failed on the bank page: never credited
    for (const [n, code] of [[2, '1'], [3, '3'], [4, '4'], [5, '5']] as const) {
      await adapter.createPaymentIntent({ ...BASE, reference: cardRef(n), redirect_url: `${RETURN}${cardRef(n)}`, metadata: { payment_method: 'card' } });
      [...orders.values()].find((o: any) => o.reference === cardRef(n)).status = code;
      expect((await adapter.getTransactionStatus(cardRef(n))).status).toBe('FAILED');
    }
  });

  it('a wrong token is refused by FlexPaie and reported as an authentication problem', async () => {
    const adapter = new FlexPaieAdapter({ get: (k: string, d?: any) => ({ ...CONFIG, FLEXPAIE_BASE_URL: base, FLEXPAIE_TOKEN: 'wrong' })[k] ?? d } as any, setup().fake.service);
    await expect(adapter.createPaymentIntent({ ...BASE, customer: { phone: '0891234567' } })).rejects.toThrow(/Authentication failed/);
  });

  it('an unreachable FlexPaie is an error to create a payment, but only "still waiting" to ask about one', async () => {
    const adapter = new FlexPaieAdapter({ get: (k: string, d?: any) => ({ ...CONFIG, FLEXPAIE_BASE_URL: 'http://127.0.0.1:9' })[k] ?? d } as any, setup().fake.service);
    await expect(adapter.createPaymentIntent({ ...BASE, customer: { phone: '0891234567' } })).rejects.toThrow(/unreachable/);
    expect((await adapter.getTransactionStatus(BASE.reference)).status).toBe('PENDING');
  });

  it('says WHY and at which host (never the token or the path), so "fetch failed" can be told apart', async () => {
    const { adapter } = setup();
    const err: any = new TypeError('fetch failed');
    err.cause = { code: 'ENOTFOUND' };
    fetchMock.mockRejectedValue(err);
    const e: Error = await adapter.createPaymentIntent({ ...BASE, customer: { phone: '0891234567' } }).catch((x) => x);
    expect(e.message).toContain('fetch failed (ENOTFOUND)');
    expect(e.message).toContain('[host: pay.flexpay.test:8443]');
    expect(e.message).not.toContain(TOKEN);
    expect(e.message).not.toContain('paymentService');
  });
});
