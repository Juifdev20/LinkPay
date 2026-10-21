import * as http from 'http';
import { FlexPaieAdapter, PAYOUT_NO_NEWS_MS, PAYOUT_RETRY_FOR_MS, payoutReference } from './flexpaie.adapter';
import { PayoutNotSentError, PayoutRetryLaterError, isManualPayout } from '../psp.adapter';

// FlexPaie PayoutService (documentation v1.03): its own login, POST …/pay, GET …/check/<orderNumber>.

const PASSWORD = 'pw-secret-123';
const CFG: Record<string, string> = {
  FLEXPAIE_PAYOUTS_ENABLED: 'true',
  FLEXPAIE_PAYOUT_AUTH_URL: 'https://payout.flexpay.test/api/v1/auth/authenticate',
  FLEXPAIE_PAYOUT_URL: 'https://payout.flexpay.test/v1/pay',
  FLEXPAIE_PAYOUT_CHECK_URL: 'https://apicheck.flexpay.test/api/rest/v1/check',
  FLEXPAIE_PAYOUT_USERNAME: 'scanlink',
  FLEXPAIE_PAYOUT_PASSWORD: PASSWORD,
  FLEXPAIE_MERCHANT: 'SCANLINK',
};
const REF = '11111111-1111-4111-8111-111111111111';
const SENT1 = 'RET-1111111111114111-1';
const PARAMS = { reference: REF, amount_cents: 500000, currency: 'CDF', channel: 'mobile_money' as const, destination: { operator: 'mpesa', phone: '+243 81 234 56 78' }, callback_url: 'https://api.example/api/v1/webhooks/payouts/flexpaie' };

/** The journal (flexpaie_payouts) in memory: insert (unique reference), update with filters, select … maybeSingle. */
function journal(initial: Record<string, any> = {}) {
  const now = new Date().toISOString();
  const rows = new Map<string, any>(Object.entries(initial).map(([k, v]) => [k, { reference: k, order_number: null, state: 'SENDING', attempts: 1, last_error: null, created_at: now, updated_at: now, ...v }]));
  const from = () => {
    const st: any = { op: 'select', filters: [] as [string, any][], returning: false };
    const run = () => {
      const match = (r: any) => st.filters.every(([c, v]: [string, any]) => r[c] === v);
      if (st.op === 'insert') {
        if (rows.has(st.row.reference)) return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
        rows.set(st.row.reference, { order_number: null, attempts: 1, last_error: null, created_at: now, updated_at: now, ...st.row });
        return { data: null, error: null };
      }
      const hit = [...rows.values()].filter(match);
      if (st.op === 'update') {
        hit.forEach((r) => Object.assign(r, st.patch));
        return { data: st.returning ? hit.map((r) => ({ reference: r.reference })) : null, error: null };
      }
      return { data: hit[0] ?? null, error: null };
    };
    const b: any = {
      select: () => { if (st.op !== 'select') st.returning = true; return b; },
      insert: (row: any) => { st.op = 'insert'; st.row = row; return b; },
      update: (patch: any) => { st.op = 'update'; st.patch = patch; return b; },
      eq: (c: string, v: any) => { st.filters.push([c, v]); return b; },
      maybeSingle: () => b,
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return b;
  };
  return { rows, service: { getClient: () => ({ from }) } as any };
}

const reply = (body: any, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as any;
const LOGIN = reply({ code: '0', token: 'Bearer payout-token-1', expire_in: 3600 });
const ACCEPTED = (orderNumber = 'LeR4frf045091721') => reply({ code: '0', status: '0XX0', message: 'Success', orderNumber });
const REFUSED = (status: string, message = 'Refusé') => reply({ code: '1', status, message });

let fetchMock: jest.Mock;
const realFetch = (global as any).fetch;
beforeEach(() => { fetchMock = jest.fn(); (global as any).fetch = fetchMock; });
afterAll(() => { (global as any).fetch = realFetch; });
const calls = () => fetchMock.mock.calls.map(([url, init]) => ({ url, method: init.method, auth: init.headers.Authorization, body: init.body ? JSON.parse(init.body) : undefined }));

function setup(opts: { config?: Record<string, string>; rows?: Record<string, any> } = {}) {
  const j = journal(opts.rows);
  const adapter = new FlexPaieAdapter({ get: (k: string, d?: any) => (opts.config ?? CFG)[k] ?? d } as any, j.service);
  return { adapter, rows: j.rows };
}

describe('references and amounts', () => {
  it('a short reference (the shape FlexPaie accepts for payments), new for each attempt', () => {
    expect(payoutReference(REF, 1)).toBe(SENT1);
    expect(payoutReference(REF, 1).length).toBeLessThanOrEqual(25);
    expect(payoutReference(REF, 1440).length).toBeLessThanOrEqual(25);
  });

  it('what FlexPaie would refuse is said BEFORE the wallet is debited', () => {
    const { adapter } = setup();
    const mm = (amount_cents: number, currency = 'CDF') => adapter.checkPayout({ amount_cents, currency, channel: 'mobile_money' });
    expect(mm(100_00)).toBeNull();
    expect(mm(99_00)).toMatch(/Montant minimum.*100 CDF/);
    expect(mm(1_00, 'USD')).toBeNull();
    expect(mm(50, 'USD')).toMatch(/entiers|minimum/);
    expect(mm(100_50)).toMatch(/entiers/);
    expect(mm(100_00, 'EUR')).toMatch(/CDF ou en USD/);
    // a bank withdrawal (manual) or payouts switched off: nothing to say
    expect(adapter.checkPayout({ amount_cents: 50, currency: 'CDF', channel: 'bank' })).toBeNull();
    expect(setup({ config: { ...CFG, FLEXPAIE_PAYOUTS_ENABLED: '' } }).adapter.checkPayout({ amount_cents: 50, currency: 'CDF', channel: 'mobile_money' })).toBeNull();
  });
});

describe('switching automatic withdrawals on', () => {
  it('off unless FLEXPAIE_PAYOUTS_ENABLED=true: withdrawals stay manual and nothing is sent', async () => {
    const { adapter } = setup({ config: { ...CFG, FLEXPAIE_PAYOUTS_ENABLED: '' } });
    expect(adapter.supportsPayout).toBe(false);
    expect(isManualPayout(adapter, 'mobile_money')).toBe(true);
    await expect(adapter.payout(PARAMS)).rejects.toBeInstanceOf(PayoutNotSentError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('on but with a missing access value: still manual (never half-configured)', () => {
    const { adapter } = setup({ config: { ...CFG, FLEXPAIE_PAYOUT_PASSWORD: '' } });
    expect(adapter.supportsPayout).toBe(false);
  });

  it('on: Mobile Money is automatic, a bank account still waits for an admin', () => {
    const { adapter } = setup();
    expect(adapter.supportsPayout).toBe(true);
    expect(isManualPayout(adapter, 'mobile_money')).toBe(false);
    expect(isManualPayout(adapter, 'bank')).toBe(true);
  });
});

describe('sending a withdrawal', () => {
  it('logs in, then sends the documented request with that token; the journal keeps the order number', async () => {
    const { adapter, rows } = setup();
    fetchMock.mockResolvedValueOnce(LOGIN).mockResolvedValueOnce(ACCEPTED());
    await expect(adapter.payout(PARAMS)).resolves.toEqual({ psp_payout_id: 'LeR4frf045091721', status: 'PENDING' });
    const [login, pay] = calls();
    expect(login).toEqual({ url: CFG.FLEXPAIE_PAYOUT_AUTH_URL, method: 'POST', auth: undefined, body: { username: 'scanlink', password: PASSWORD } });
    expect(pay).toEqual({
      url: CFG.FLEXPAIE_PAYOUT_URL, method: 'POST', auth: 'Bearer payout-token-1',
      body: { merchant: 'SCANLINK', type: '1', reference: SENT1, amount: '5000', currency: 'CDF', customer: '243812345678', description: `Retrait ScanLinkPay ${SENT1}`, callback_url: PARAMS.callback_url },
    });
    expect(rows.get(REF)).toMatchObject({ state: 'ACCEPTED', order_number: 'LeR4frf045091721', sent_reference: SENT1 });
  });

  it('reuses the token until it expires (one login for several withdrawals)', async () => {
    const { adapter } = setup();
    fetchMock.mockResolvedValueOnce(LOGIN).mockResolvedValueOnce(ACCEPTED('O1')).mockResolvedValueOnce(ACCEPTED('O2'));
    await adapter.payout(PARAMS);
    await adapter.payout({ ...PARAMS, reference: '22222222-2222-4222-8222-222222222222' });
    expect(calls().filter((c) => c.url === CFG.FLEXPAIE_PAYOUT_AUTH_URL)).toHaveLength(1);
  });

  it('accepts the "OXX0" spelling of the documentation example (letter O)', async () => {
    const { adapter } = setup();
    fetchMock.mockResolvedValueOnce(LOGIN).mockResolvedValueOnce(reply({ code: '0', status: 'OXX0', message: 'Success', orderNumber: 'O9' }));
    await expect(adapter.payout(PARAMS)).resolves.toEqual({ psp_payout_id: 'O9', status: 'PENDING' });
  });

  it('an already accepted withdrawal is never sent a second time', async () => {
    const { adapter } = setup({ rows: { [REF]: { state: 'ACCEPTED', order_number: 'O1' } } });
    await expect(adapter.payout(PARAMS)).resolves.toEqual({ psp_payout_id: 'O1', status: 'PENDING' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses before sending anything: cents, an invalid number, a bank account', async () => {
    const { adapter } = setup();
    await expect(adapter.payout({ ...PARAMS, amount_cents: 500050 })).rejects.toBeInstanceOf(PayoutNotSentError);
    await expect(adapter.payout({ ...PARAMS, destination: { phone: '12' } })).rejects.toBeInstanceOf(PayoutNotSentError);
    await expect(adapter.payout({ ...PARAMS, channel: 'bank' })).rejects.toBeInstanceOf(PayoutNotSentError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('what FlexPaie answers (0XX1 … 0XX5)', () => {
  it('0XX1 another payout in progress: not sent, tried again later (journal NOT_SENT), then sent', async () => {
    const { adapter, rows } = setup();
    fetchMock.mockResolvedValueOnce(LOGIN).mockResolvedValueOnce(REFUSED('0XX1', 'Une transaction est en attente'));
    await expect(adapter.payout(PARAMS)).rejects.toBeInstanceOf(PayoutRetryLaterError);
    expect(rows.get(REF).state).toBe('NOT_SENT');
    expect(await adapter.getPayoutStatus(REF)).toEqual({ status: 'NOT_SENT' });

    fetchMock.mockResolvedValueOnce(ACCEPTED('O7'));
    await expect(adapter.payout(PARAMS)).resolves.toEqual({ psp_payout_id: 'O7', status: 'PENDING' });
    expect(rows.get(REF)).toMatchObject({ state: 'ACCEPTED', attempts: 2, sent_reference: 'RET-1111111111114111-2' });
    // a NEW reference for the new attempt: never refused as a duplicate of the one FlexPaie turned down
    const sent = calls().filter((c) => c.url === CFG.FLEXPAIE_PAYOUT_URL).map((c) => c.body.reference);
    expect(sent).toEqual([SENT1, 'RET-1111111111114111-2']);
  });

  it('0XX2 our FlexPaie balance is too low: refunded, and the administrators are told to top it up', async () => {
    const { adapter } = setup();
    fetchMock.mockResolvedValueOnce(LOGIN).mockResolvedValueOnce(REFUSED('0XX2'));
    const e: PayoutNotSentError = await adapter.payout(PARAMS).catch((x) => x);
    expect(e).toBeInstanceOf(PayoutNotSentError);
    expect(e.message).toBe('Le service de retrait est momentanément indisponible.');
    expect(e.adminAlert).toMatch(/Solde FlexPaie insuffisant.*5000 CDF/);
  });

  it('0XX3 number not supported: refunded with a message for the customer, no admin alert', async () => {
    const { adapter } = setup();
    fetchMock.mockResolvedValueOnce(LOGIN).mockResolvedValueOnce(REFUSED('0XX3'));
    const e: PayoutNotSentError = await adapter.payout(PARAMS).catch((x) => x);
    expect(e.message).toMatch(/numéro Mobile Money n'est pas pris en charge/);
    expect(e.adminAlert).toBeUndefined();
  });

  it('0XX4 token problem: logs in again and sends once more', async () => {
    const { adapter } = setup();
    fetchMock
      .mockResolvedValueOnce(LOGIN).mockResolvedValueOnce(REFUSED('0XX4'))
      .mockResolvedValueOnce(reply({ code: '0', token: 'Bearer payout-token-2', expire_in: 3600 })).mockResolvedValueOnce(ACCEPTED('O3'));
    await expect(adapter.payout(PARAMS)).resolves.toEqual({ psp_payout_id: 'O3', status: 'PENDING' });
    expect(calls()[3].auth).toBe('Bearer payout-token-2');
  });

  it('0XX5 other error: refunded with FlexPaie\'s own message', async () => {
    const { adapter } = setup();
    fetchMock.mockResolvedValueOnce(LOGIN).mockResolvedValueOnce(REFUSED('0XX5', 'Montant inférieur au minimum'));
    await expect(adapter.payout(PARAMS)).rejects.toThrow('Montant inférieur au minimum');
  });

  it('login refused: refunded and the administrators are told to check the access', async () => {
    const { adapter, rows } = setup();
    fetchMock.mockResolvedValueOnce(reply({ code: '1', message: 'Identifiants invalides' }));
    const e: PayoutNotSentError = await adapter.payout(PARAMS).catch((x) => x);
    expect(e).toBeInstanceOf(PayoutNotSentError);
    expect(e.adminAlert).toMatch(/FLEXPAIE_PAYOUT_USERNAME/);
    expect(rows.has(REF)).toBe(false);
  });
});

describe('when the answer is lost', () => {
  const timeout = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });

  it('timeout: NOT refunded and NEVER resent (the money may have left); stays waiting', async () => {
    const { adapter, rows } = setup();
    fetchMock.mockResolvedValueOnce(LOGIN).mockRejectedValueOnce(timeout());
    const e = await adapter.payout(PARAMS).catch((x) => x);
    expect(e).not.toBeInstanceOf(PayoutNotSentError);
    expect(e).not.toBeInstanceOf(PayoutRetryLaterError);
    expect(rows.get(REF).state).toBe('SENDING');

    await expect(adapter.payout(PARAMS)).rejects.toThrow(/not sent again/);
    expect(calls().filter((c) => c.url === CFG.FLEXPAIE_PAYOUT_URL)).toHaveLength(1);
    expect(await adapter.getPayoutStatus(REF)).toEqual({ status: 'PENDING' });
  });

  it('no news at all for 30 minutes: taken as never sent and refunded (journal ABANDONED)', async () => {
    const old = new Date(Date.now() - PAYOUT_NO_NEWS_MS - 1000).toISOString();
    const { adapter, rows } = setup({ rows: { [REF]: { state: 'SENDING', updated_at: old } } });
    const r = await adapter.getPayoutStatus(REF);
    expect(r.status).toBe('FAILED');
    expect(rows.get(REF).state).toBe('ABANDONED');
  });

  it('the host cannot even be reached: certainly not sent, tried again later', async () => {
    const { adapter, rows } = setup();
    const refused: any = new TypeError('fetch failed');
    refused.cause = { code: 'ECONNREFUSED' };
    fetchMock.mockResolvedValueOnce(LOGIN).mockRejectedValueOnce(refused);
    await expect(adapter.payout(PARAMS)).rejects.toBeInstanceOf(PayoutRetryLaterError);
    expect(rows.get(REF).state).toBe('NOT_SENT');
  });

  it('a "busy" withdrawal is given up (refunded) after 24 hours', async () => {
    const old = new Date(Date.now() - PAYOUT_RETRY_FOR_MS - 1000).toISOString();
    const { adapter } = setup({ rows: { [REF]: { state: 'NOT_SENT', created_at: old } } });
    expect((await adapter.getPayoutStatus(REF)).status).toBe('FAILED');
  });
});

describe('the status of a payout', () => {
  const check = (body: any) => reply(body);

  it('never handed to FlexPaie (asked during the manual period): NOT_SENT, so it gets sent', async () => {
    const { adapter } = setup();
    expect(await adapter.getPayoutStatus(REF)).toEqual({ status: 'NOT_SENT' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks the check with the order number WE recorded and the PayoutService token', async () => {
    const { adapter } = setup({ rows: { [REF]: { state: 'ACCEPTED', order_number: 'O1' } } });
    fetchMock.mockResolvedValueOnce(LOGIN).mockResolvedValueOnce(check({ code: '0', reference: REF, orderNumber: 'O1', providerReference: 'BCQ036', message: 'Success', status: '0' }));
    expect(await adapter.getPayoutStatus(REF)).toEqual({ status: 'SUCCESS', psp_payout_id: 'O1' });
    expect(calls()[1]).toMatchObject({ url: `${CFG.FLEXPAIE_PAYOUT_CHECK_URL}/O1`, method: 'GET', auth: 'Bearer payout-token-1' });
  });

  it('the same codes as the payment check: 2 = still in progress, 5 = cancelled', async () => {
    const { adapter } = setup({ rows: { [REF]: { state: 'ACCEPTED', order_number: 'O1', sent_reference: SENT1 } } });
    fetchMock.mockResolvedValueOnce(LOGIN)
      .mockResolvedValueOnce(check({ code: '0', reference: SENT1, orderNumber: 'O1', status: '2' }))
      .mockResolvedValueOnce(check({ code: '0', reference: SENT1, orderNumber: 'O1', status: '5' }));
    expect((await adapter.getPayoutStatus(REF)).status).toBe('PENDING');
    expect((await adapter.getPayoutStatus(REF)).status).toBe('FAILED');
  });

  it('the PayoutService token refused by the check: the payment token is tried last', async () => {
    const { adapter } = setup({ config: { ...CFG, FLEXPAIE_TOKEN: 'collect-token' }, rows: { [REF]: { state: 'ACCEPTED', order_number: 'O1' } } });
    fetchMock.mockResolvedValueOnce(LOGIN).mockResolvedValueOnce(reply({}, 401))
      .mockResolvedValueOnce(reply({ code: '0', token: 'Bearer payout-token-2', expire_in: 3600 })).mockResolvedValueOnce(reply({}, 401))
      .mockResolvedValueOnce(check({ code: '0', reference: REF, orderNumber: 'O1', status: '0' }));
    expect((await adapter.getPayoutStatus(REF)).status).toBe('SUCCESS');
    expect(calls()[4].auth).toBe('Bearer collect-token');
  });

  it('status 1 = failed (refund); "transaction non trouvée" or another reference = keep waiting', async () => {
    const { adapter } = setup({ rows: { [REF]: { state: 'ACCEPTED', order_number: 'O1' } } });
    fetchMock.mockResolvedValueOnce(LOGIN)
      .mockResolvedValueOnce(check({ code: '1', reference: REF, orderNumber: 'O1', status: '1', message: 'Echec' }))
      .mockResolvedValueOnce(check({ code: '1', message: 'Erreur. Transaction non trouvée' }))
      .mockResolvedValueOnce(check({ code: '0', reference: 'someone-else', orderNumber: 'O1', status: '0' }));
    expect((await adapter.getPayoutStatus(REF)).status).toBe('FAILED');
    expect((await adapter.getPayoutStatus(REF)).status).toBe('PENDING');
    expect((await adapter.getPayoutStatus(REF)).status).toBe('PENDING');
  });

  it('the journal lost the order number but the withdrawal has it: that one is used (and written back)', async () => {
    const { adapter, rows } = setup({ rows: { [REF]: { state: 'SENDING' } } });
    fetchMock.mockResolvedValueOnce(LOGIN).mockResolvedValueOnce(check({ code: '0', reference: REF, orderNumber: 'O5', status: '0' }));
    expect((await adapter.getPayoutStatus(REF, { psp_reference: 'O5' })).status).toBe('SUCCESS');
    expect(rows.get(REF)).toMatchObject({ order_number: 'O5', state: 'ACCEPTED' });
  });
});

describe('the callback (unsigned: only a hint)', () => {
  const cb = (body: any) => Buffer.from(JSON.stringify(body));

  it('carries the reference of the attempt: matched back to the withdrawal', async () => {
    const { adapter, rows } = setup({ rows: { [REF]: { state: 'SENDING', sent_reference: SENT1 } } });
    fetchMock.mockResolvedValueOnce(LOGIN).mockResolvedValueOnce(reply({ code: '0', reference: SENT1, orderNumber: 'O8', status: '0' }));
    expect(await adapter.acceptPayoutCallback(cb({ code: '0', reference: SENT1, orderNumber: 'O8' }))).toBe(REF);
    expect(rows.get(REF)).toMatchObject({ order_number: 'O8', state: 'ACCEPTED' });
  });

  it('brings the order number our request lost: recorded only once FlexPaie confirms it is ours', async () => {
    const { adapter, rows } = setup({ rows: { [REF]: { state: 'SENDING' } } });
    fetchMock.mockResolvedValueOnce(LOGIN).mockResolvedValueOnce(reply({ code: '0', reference: REF, orderNumber: 'O8', status: '0' }));
    expect(await adapter.acceptPayoutCallback(cb({ code: '0', reference: REF, orderNumber: 'O8', status: '0' }))).toBe(REF);
    expect(rows.get(REF)).toMatchObject({ order_number: 'O8', state: 'ACCEPTED' });
  });

  it('a forged order number (FlexPaie says it belongs to another reference) is refused', async () => {
    const { adapter, rows } = setup({ rows: { [REF]: { state: 'SENDING' } } });
    fetchMock.mockResolvedValueOnce(LOGIN).mockResolvedValueOnce(reply({ code: '0', reference: 'other', orderNumber: 'X1', status: '0' }));
    expect(await adapter.acceptPayoutCallback(cb({ reference: REF, orderNumber: 'X1' }))).toBeNull();
    expect(rows.get(REF).order_number).toBeNull();
  });

  it('naming another order than the recorded one, or an unknown withdrawal: ignored without asking FlexPaie', async () => {
    const { adapter } = setup({ rows: { [REF]: { state: 'ACCEPTED', order_number: 'O1' } } });
    expect(await adapter.acceptPayoutCallback(cb({ reference: REF, orderNumber: 'X1' }))).toBeNull();
    expect(await adapter.acceptPayoutCallback(cb({ reference: '99999999-9999-4999-8999-999999999999', orderNumber: 'O1' }))).toBeNull();
    expect(await adapter.acceptPayoutCallback(Buffer.from('not json'))).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('against a local PayoutService double (real network calls)', () => {
  let server: http.Server;
  let base = '';
  const orders = new Map<string, any>();
  beforeEach(() => { (global as any).fetch = realFetch; });
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        const send = (body: any, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
        if (req.method === 'POST' && req.url === '/api/v1/auth/authenticate') {
          const b = JSON.parse(raw);
          return b.username === 'scanlink' && b.password === PASSWORD ? send({ code: '0', token: 'Bearer live-token', expire_in: 1234 }) : send({ code: '1', message: 'Erreur' });
        }
        if (req.headers.authorization !== 'Bearer live-token') return send({ code: '1', status: '0XX4', message: 'Token invalide' });
        if (req.method === 'POST' && req.url === '/v1/pay') {
          const b = JSON.parse(raw);
          const orderNumber = `PO${orders.size + 1}`;
          orders.set(orderNumber, { code: '0', reference: b.reference, orderNumber, message: 'En cours', status: '2', created_at: '21/10/2026 10:00:00' });
          return send({ code: '0', status: '0XX0', message: 'Success', orderNumber });
        }
        const m = /^\/api\/rest\/v1\/check\/(.+)$/.exec(req.url || '');
        if (req.method === 'GET' && m) return send(orders.get(decodeURIComponent(m[1])) ?? { code: '1', message: 'Erreur. Transaction non trouvée' });
        send({}, 404);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('a withdrawal from request to confirmation', async () => {
    const { adapter, rows } = setup({ config: { ...CFG, FLEXPAIE_PAYOUT_AUTH_URL: `${base}/api/v1/auth/authenticate`, FLEXPAIE_PAYOUT_URL: `${base}/v1/pay`, FLEXPAIE_PAYOUT_CHECK_URL: `${base}/api/rest/v1/check/orderNumber` } });
    await expect(adapter.payout(PARAMS)).resolves.toEqual({ psp_payout_id: 'PO1', status: 'PENDING' });
    expect(rows.get(REF)).toMatchObject({ state: 'ACCEPTED', order_number: 'PO1' });
    expect((await adapter.getPayoutStatus(REF)).status).toBe('PENDING');
    orders.get('PO1').status = '0';
    expect(await adapter.getPayoutStatus(REF)).toEqual({ status: 'SUCCESS', psp_payout_id: 'PO1' });
  });
});
