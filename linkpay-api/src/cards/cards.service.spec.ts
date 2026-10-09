import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CardsService, extractQrToken, MAX_PENDING_CHARGES_PER_CARD } from './cards.service';
import { createFakeSupabase, has, RecordedQuery } from '../test-utils/fake-supabase';
import { validateCardSettings } from './card-settings';

const USER = 'u-holder';
const NUMBER = '9243001234567895';
const TOKEN = 'K7Q2M9XD4TWB';
const FUTURE = '2099-12-31';
const CARD = { id: 'c1', user_id: USER, wallet_id: 'w1', status: 'active', card_number: NUMBER, qr_token: TOKEN, expires_on: FUTURE, holder_name: 'AMINA KABONGO', print_count: 0 };

type Handlers = Record<string, (q: RecordedQuery) => any>;
const opOf = (q: RecordedQuery) => (['insert', 'update', 'delete', 'upsert'].find((m) => has(q, m)) ?? (q.target.startsWith('rpc:') ? 'rpc' : 'select'));

function setup(handlers: Handlers = {}, extra: { pinOk?: boolean; payFails?: any } = {}) {
  const fake = createFakeSupabase((q) => {
    const h = handlers[`${q.target}:${opOf(q)}`] ?? handlers[q.target];
    return h ? h(q) : { data: null };
  });
  const walletPins = { verifyPin: jest.fn(async () => { if (extra.pinOk === false) throw new BadRequestException('Code PIN incorrect'); }) };
  const attempts = { reserve: jest.fn(async () => ({ justLocked: false })), recordSuccess: jest.fn(async () => undefined) };
  const notifications = { create: jest.fn(async () => undefined) };
  const audit = { log: jest.fn(async () => undefined) };
  const payments = { payWithWallet: jest.fn(async () => { if (extra.payFails) throw extra.payFails; return { status: 'SUCCESS' }; }) };
  const paymentRequests = { createPaymentRequest: jest.fn(async () => ({ id: 'pr1', link_token: 'lt' })) };
  const wallets = { getMyWallet: jest.fn(async () => ({ balances: { CDF: 1000, USD: 5 } })) };
  const config = { get: (_k: string, d?: any) => d };
  const service = new CardsService(fake.service, wallets as any, walletPins as any, attempts as any, notifications as any, audit as any, payments as any, paymentRequests as any, config as any);
  return { service, fake, walletPins, attempts, notifications, audit, payments, paymentRequests };
}
const writes = (fake: any, table: string, op: string): RecordedQuery[] => fake.queries.filter((q: RecordedQuery) => q.target === table && has(q, op));

describe('extractQrToken', () => {
  it('reads the token from the link in the QR code, or typed by hand', () => {
    expect(extractQrToken(`https://scanlinkpay.com/c/${TOKEN}`)).toBe(TOKEN);
    expect(extractQrToken(`http://localhost:5173/c/${TOKEN.toLowerCase()}?x=1`)).toBe(TOKEN);
    expect(extractQrToken(TOKEN)).toBe(TOKEN);
  });
  it('refuses anything else', () => {
    for (const bad of ['', 'https://evil.example/c/short', 'https://x/c/ILOUILOUILOU', "'; drop table cards;--", '../../x']) expect(extractQrToken(bad)).toBeNull();
  });
});

describe('request', () => {
  it('asks for a card on the own wallet', async () => {
    const { service, fake } = setup({ wallets: () => ({ data: { id: 'w1', status: 'ACTIVE' } }), 'cards:insert': () => ({ data: { id: 'c9', status: 'requested' } }) });
    await expect(service.requestCard(USER)).resolves.toEqual({ id: 'c9', status: 'requested' });
    expect(writes(fake, 'cards', 'insert')[0].calls.find((c) => c.method === 'insert')!.args[0]).toMatchObject({ user_id: USER, wallet_id: 'w1', status: 'requested' });
  });
  it('a second request is a conflict, not a second card', async () => {
    const { service } = setup({ wallets: () => ({ data: { id: 'w1', status: 'ACTIVE' } }), 'cards:insert': () => ({ error: { code: '23505', message: 'dup' } }) });
    await expect(service.requestCard(USER)).rejects.toBeInstanceOf(ConflictException);
  });
  it('refuses a frozen wallet and a missing one', async () => {
    await expect(setup({ wallets: () => ({ data: { id: 'w1', status: 'FROZEN' } }) }).service.requestCard(USER)).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ wallets: () => ({ data: null }) }).service.requestCard(USER)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('activation', () => {
  const issued = { ...CARD, status: 'issued' };
  const live = (card: any, extraHandlers: Handlers = {}): Handlers => ({
    'cards:select': () => ({ data: card }),
    'cards:update': () => ({ data: { id: 'c1' } }),
    ...extraHandlers,
  });

  it('activates with the 16 digits (typed with spaces) and the PIN', async () => {
    const { service, attempts, walletPins, fake } = setup(live(issued));
    await expect(service.activate(USER, '9243 0012 3456 7895', '1234')).resolves.toEqual({ status: 'active' });
    expect(attempts.reserve).toHaveBeenCalledWith(`card-activate:${USER}`);
    expect(walletPins.verifyPin).toHaveBeenCalledWith(USER, '1234');
    expect(attempts.recordSuccess).toHaveBeenCalled();
    const upd = writes(fake, 'cards', 'update')[0];
    expect(upd.calls.find((c) => c.method === 'update')!.args[0].status).toBe('active');
    expect(has(upd, 'eq', 'status', 'issued')).toBe(true); // only an issued card can become active
  });

  it('a wrong number is refused, counts as an attempt, and never reaches the PIN', async () => {
    const { service, attempts, walletPins, fake } = setup(live(issued));
    await expect(service.activate(USER, '9243 0012 3456 7903', '1234')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.activate(USER, 'abcd', '1234')).rejects.toBeInstanceOf(BadRequestException);
    expect(attempts.reserve).toHaveBeenCalledTimes(2);
    expect(walletPins.verifyPin).not.toHaveBeenCalled();
    expect(writes(fake, 'cards', 'update')).toHaveLength(0);
  });

  it('the right number with a wrong PIN does not activate', async () => {
    const { service, fake } = setup(live(issued), { pinOk: false });
    await expect(service.activate(USER, NUMBER, '0000')).rejects.toBeInstanceOf(BadRequestException);
    expect(writes(fake, 'cards', 'update')).toHaveLength(0);
  });

  it('only a card waiting to be activated can be: not an active one, not an expired one, not none', async () => {
    await expect(setup(live({ ...CARD, status: 'active' })).service.activate(USER, NUMBER, '1234')).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup(live({ ...issued, expires_on: '2001-01-31' })).service.activate(USER, NUMBER, '1234')).rejects.toThrow(/expirée/);
    await expect(setup(live(null)).service.activate(USER, NUMBER, '1234')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('freeze / unfreeze / lost', () => {
  const live = (card: any): Handlers => ({
    'cards:select': () => ({ data: card }),
    'cards:update': () => ({ data: { id: 'c1' } }),
    'card_charges:select': () => ({ data: [{ id: 'ch1', payment_request_id: 'pr1' }] }),
  });

  it('freezing cancels what was waiting to be paid', async () => {
    const { service, fake } = setup(live(CARD));
    await service.freeze(USER);
    expect(writes(fake, 'card_charges', 'update')).toHaveLength(1);
    expect(writes(fake, 'payment_requests', 'update')[0].calls.find((c) => c.method === 'update')!.args[0].status).toBe('CANCELLED');
  });
  it('unfreezing needs the PIN', async () => {
    const { service, walletPins } = setup(live({ ...CARD, status: 'frozen' }));
    await service.unfreeze(USER, '1234');
    expect(walletPins.verifyPin).toHaveBeenCalled();
    await expect(setup(live({ ...CARD, status: 'frozen' }), { pinOk: false }).service.unfreeze(USER, '0')).rejects.toBeInstanceOf(BadRequestException);
  });
  it('only an active card can be frozen', async () => {
    await expect(setup(live({ ...CARD, status: 'issued' })).service.freeze(USER)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('reporting a loss needs the PIN, blocks the card for good and is audited', async () => {
    const { service, fake, audit } = setup(live(CARD));
    await service.reportLost(USER, '1234');
    const upd = writes(fake, 'cards', 'update')[0].calls.find((c) => c.method === 'update')!.args[0];
    expect(upd).toMatchObject({ status: 'blocked', blocked_reason: 'lost' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CARD_REPORTED_LOST' }));
    await expect(setup(live(CARD), { pinOk: false }).service.reportLost(USER, '0')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('what the card owner sees', () => {
  it('shows the number and the QR only once the card is issued, and the balances of the wallet', async () => {
    const mine = (card: any) => setup({ 'cards:select': () => ({ data: card }) }).service.getMyCard(USER);
    const requested = await mine({ ...CARD, status: 'requested', card_number: null, qr_token: null });
    expect(requested.card).toMatchObject({ status: 'requested', card_number: null, qr_url: null });
    const active = await mine(CARD);
    expect(active.card).toMatchObject({ status: 'active', card_number: NUMBER });
    expect(active.card!.qr_url).toBe(`http://localhost:5173/c/${TOKEN}`);
    expect(active.balances).toEqual({ CDF: 1000, USD: 5 });
    expect(active.can_request).toBe(false);
  });
  it('an expired card reads "expired"', async () => {
    const r = await setup({ 'cards:select': () => ({ data: { ...CARD, expires_on: '2001-01-31' } }) }).service.getMyCard(USER);
    expect(r.card!.status).toBe('expired');
  });
  it('the QR link uses the domain set by the super admin', async () => {
    const { service } = setup({ card_settings: () => ({ data: { web_domain: 'scanlinkpay.com', validity_years: 3, partner_logos: [] } }), 'cards:select': () => ({ data: CARD }) });
    expect((await service.getMyCard(USER)).card!.qr_url).toBe(`https://scanlinkpay.com/c/${TOKEN}`);
  });
});

describe('issuing (super admin)', () => {
  const base = (rpc: (n: number) => any): Handlers => {
    let n = 0;
    return {
      wallets: () => ({ data: { id: 'w1', user_id: USER, wallet_number: 'LP-00000001', status: 'ACTIVE' } }),
      profiles: () => ({ data: { full_name: 'Amina Kabongo', email: 'a@b.c' } }),
      'rpc:issue_card': () => rpc(++n),
    };
  };
  const row = { id: 'c1', serial_no: 7, status: 'issued', card_number: NUMBER, holder_name: 'AMINA KABONGO' };

  it('issues from the ScanLinkPay number: name in capitals, validity from the settings, audit and a notice to the person', async () => {
    const { service, fake, audit, notifications } = setup(base(() => ({ data: [row] })));
    const r = await service.issue('admin1', { wallet_number: ' lp-00000001 ' });
    expect(r).toMatchObject({ id: 'c1', status: 'issued', wallet_number: 'LP-00000001' });
    const args = fake.queries.find((q) => q.target === 'rpc:issue_card')!.calls[0].args[0];
    expect(args).toMatchObject({ p_user: USER, p_wallet: 'w1', p_holder_name: 'AMINA KABONGO', p_admin: 'admin1', p_replace: false });
    expect(args.p_card_number).toMatch(/^924300\d{10}$/);
    expect(args.p_qr_token).toMatch(/^[0-9A-Z]{12}$/);
    expect(args.p_expires_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CARD_ISSUED' }));
    // The audit trail never holds the full number.
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain(NUMBER);
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: USER, type: 'card' }));
  });

  it('redraws the number when it is already taken (and gives up after a few tries)', async () => {
    const { service, fake } = setup(base((n) => (n < 3 ? { error: { code: '23505', message: 'dup' } } : { data: [row] })));
    await service.issue('admin1', { wallet_number: 'LP-00000001' });
    const calls = fake.queries.filter((q) => q.target === 'rpc:issue_card');
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((q) => q.calls[0].args[0].p_card_number)).size).toBe(3);
    await expect(setup(base(() => ({ error: { code: '23505', message: 'dup' } }))).service.issue('a', { wallet_number: 'LP-1' })).rejects.toThrow(/free number/);
  });

  it('tells the admin when the person already has a card, and replaces it on request', async () => {
    const { service } = setup(base(() => ({ error: { message: 'CARD_ALREADY_EXISTS' } })));
    await expect(service.issue('admin1', { wallet_number: 'LP-00000001' })).rejects.toBeInstanceOf(ConflictException);
    const { service: s2, fake, audit } = setup(base(() => ({ data: [row] })));
    await s2.issue('admin1', { wallet_number: 'LP-00000001', replace: true });
    expect(fake.queries.find((q) => q.target === 'rpc:issue_card')!.calls[0].args[0].p_replace).toBe(true);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CARD_REPLACED' }));
  });

  it('refuses an unknown number, a frozen wallet, and an empty request', async () => {
    await expect(setup({ wallets: () => ({ data: null }) }).service.issue('a', { wallet_number: 'LP-9' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup({ wallets: () => ({ data: { id: 'w1', user_id: USER, status: 'FROZEN' } }) }).service.issue('a', { wallet_number: 'LP-1' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup().service.issue('a', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('issues a request made in the app, only while it is still a request', async () => {
    const h = base(() => ({ data: [row] }));
    h['cards:select'] = () => ({ data: { wallet_id: 'w1', status: 'requested' } });
    await expect(setup(h).service.issue('a', { card_id: 'c1' })).resolves.toMatchObject({ id: 'c1' });
    h['cards:select'] = () => ({ data: { wallet_id: 'w1', status: 'active' } });
    await expect(setup(h).service.issue('a', { card_id: 'c1' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('printing', () => {
  it('only a card waiting to be handed over can be printed, and every print is counted and audited', async () => {
    const { service, fake, audit } = setup({ 'cards:select': () => ({ data: { ...CARD, status: 'issued' } }) });
    const r = await service.printData('admin1', 'c1');
    expect(r).toMatchObject({ card_number: NUMBER, card_number_formatted: '9243 0012 3456 7895', holder_name: 'AMINA KABONGO' });
    expect(r.qr_url).toBe(`http://localhost:5173/c/${TOKEN}`);
    expect(writes(fake, 'cards', 'update')[0].calls.find((c) => c.method === 'update')!.args[0].print_count).toBe(1);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CARD_PRINTED' }));
    await expect(setup({ 'cards:select': () => ({ data: { ...CARD, status: 'active' } }) }).service.printData('a', 'c1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ 'cards:select': () => ({ data: { ...CARD, status: 'requested' } }) }).service.printData('a', 'c1')).rejects.toThrow(/Émettez/);
  });
});

describe('admin block', () => {
  it('blocks a live card, cancels its open charges and tells the holder', async () => {
    const { service, notifications, audit, fake } = setup({
      'cards:select': () => ({ data: CARD }), 'cards:update': () => ({ data: null }),
      'card_charges:select': () => ({ data: [{ id: 'ch1', payment_request_id: 'pr1' }] }),
    });
    await service.adminBlock('admin1', 'c1', 'fraude');
    expect(writes(fake, 'cards', 'update')[0].calls.find((c) => c.method === 'update')!.args[0]).toMatchObject({ status: 'blocked', blocked_reason: 'fraude' });
    expect(writes(fake, 'card_charges', 'update')).toHaveLength(1);
    expect(notifications.create).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CARD_BLOCKED' }));
  });
  it('a card already blocked or replaced cannot be blocked again', async () => {
    await expect(setup({ 'cards:select': () => ({ data: { ...CARD, status: 'blocked' } }) }).service.adminBlock('a', 'c1', 'x')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('charging a card (the till)', () => {
  const caller = { userId: 'u-shop', merchantId: 'm1' };
  const dto = { qr_token: `https://scanlinkpay.com/c/${TOKEN}`, amount_cents: 50000, currency: 'CDF' };
  const handlers = (card: any = CARD, pending = 0): Handlers => ({
    'cards:select': () => ({ data: card }),
    'card_charges:select': (q) => (has(q, 'select', 'id', { count: 'exact', head: true }) ? { count: pending } : { data: [] }),
    'card_charges:insert': () => ({ data: { id: 'ch1' } }),
    merchants: () => ({ data: { name: 'Chez Mama' } }),
    profiles: () => ({ data: { full_name: 'Amina Marie Kabongo' } }),
  });

  it('creates a payment request bound to the card, short-lived, and warns the holder — the merchant learns a first name, never a balance', async () => {
    const { service, paymentRequests, notifications, fake } = setup(handlers());
    const r = await service.createCharge(caller, dto);
    expect(r).toMatchObject({ charge_id: 'ch1', status: 'pending', amount_cents: 50000, currency: 'CDF', holder: 'Amina K.' });
    expect(JSON.stringify(r)).not.toMatch(/balance|CDF":/);
    expect(paymentRequests.createPaymentRequest).toHaveBeenCalledWith('m1', 'u-shop', expect.objectContaining({ amount_cents: 50000, currency: 'CDF', expires_in_minutes: 3 }), { withQrCode: false });
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: USER, type: 'card_charge', data: { charge_id: 'ch1' } }));
    expect(writes(fake, 'card_charges', 'insert')[0].calls.find((c) => c.method === 'insert')!.args[0]).toMatchObject({ card_id: 'c1', merchant_id: 'm1', payment_request_id: 'pr1' });
  });

  it('finds the card from its number as well, checking the Luhn digit first', async () => {
    const { service, fake } = setup(handlers());
    await service.createCharge(caller, { card_number: '9243 0012 3456 7895', amount_cents: 50000, currency: 'CDF' });
    expect(has(fake.queries.find((q) => q.target === 'cards')!, 'eq', 'card_number', NUMBER)).toBe(true);
    const { service: s2, fake: f2 } = setup(handlers());
    await expect(s2.createCharge(caller, { card_number: '9243 0012 3456 7890', amount_cents: 50000, currency: 'CDF' })).rejects.toBeInstanceOf(NotFoundException);
    expect(f2.queries.filter((q) => q.target === 'cards')).toHaveLength(0); // a mistyped number never touches the database
  });

  it.each([['frozen'], ['blocked'], ['issued'], ['requested'], ['replaced']])('a %s card gives the same answer as no card at all', async (status) => {
    const { service, paymentRequests } = setup(handlers({ ...CARD, status }));
    await expect(service.createCharge(caller, dto)).rejects.toThrow('Carte introuvable ou non activée.');
    expect(paymentRequests.createPaymentRequest).not.toHaveBeenCalled();
  });
  it('an expired card, an unknown token and a missing card are refused alike', async () => {
    await expect(setup(handlers({ ...CARD, expires_on: '2001-01-31' })).service.createCharge(caller, dto)).rejects.toThrow('Carte introuvable ou non activée.');
    await expect(setup(handlers(null)).service.createCharge(caller, dto)).rejects.toThrow('Carte introuvable ou non activée.');
    await expect(setup(handlers()).service.createCharge(caller, { ...dto, qr_token: 'nonsense' })).rejects.toThrow('Carte introuvable ou non activée.');
    await expect(setup(handlers()).service.createCharge(caller, { amount_cents: 1, currency: 'CDF' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('nobody charges their own card', async () => {
    const { service, paymentRequests } = setup(handlers());
    await expect(service.createCharge({ userId: USER, merchantId: 'm1' }, dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(paymentRequests.createPaymentRequest).not.toHaveBeenCalled();
  });

  it('a card cannot be flooded with requests', async () => {
    const { service, paymentRequests } = setup(handlers(CARD, MAX_PENDING_CHARGES_PER_CARD));
    await expect(service.createCharge(caller, dto)).rejects.toMatchObject({ status: 429 });
    expect(paymentRequests.createPaymentRequest).not.toHaveBeenCalled();
  });

  it('cancels the payment request when the charge cannot be saved', async () => {
    const h = handlers();
    h['card_charges:insert'] = () => ({ error: { message: 'boom' } });
    const { service, fake } = setup(h);
    await expect(service.createCharge(caller, dto)).rejects.toThrow(/Failed to create the card charge/);
    expect(writes(fake, 'payment_requests', 'update')[0].calls.find((c) => c.method === 'update')!.args[0].status).toBe('CANCELLED');
  });
});

describe('approving a charge (the holder)', () => {
  const CHARGE = { id: 'ch1', card_id: 'c1', merchant_id: 'm1', payment_request_id: 'pr1', amount_cents: 50000, currency: 'CDF', status: 'pending', expires_at: new Date(Date.now() + 120_000).toISOString() };
  const handlers = (over: { charge?: any; card?: any; claim?: any } = {}): Handlers => ({
    'card_charges:select': () => ({ data: over.charge ?? CHARGE }),
    'cards:select': () => ({ data: over.card ?? CARD }),
    'payment_requests:select': () => ({ data: { status: 'CREATED', link_token: 'lt' } }),
    'card_charges:update': () => ({ data: over.claim === undefined ? { id: 'ch1', payment_request_id: 'pr1' } : over.claim }),
  });
  const statuses = (fake: any) => writes(fake, 'card_charges', 'update').map((q: RecordedQuery) => q.calls.find((c) => c.method === 'update')!.args[0].status);

  it('pays through the existing wallet payment, with the PIN, then marks it approved', async () => {
    const { service, payments, fake, audit } = setup(handlers());
    await expect(service.approve(USER, 'ch1', '1234')).resolves.toEqual({ status: 'approved' });
    expect(payments.payWithWallet).toHaveBeenCalledWith(USER, 'lt', '1234', expect.stringMatching(/^card-charge-ch1-/));
    expect(statuses(fake)).toEqual(['processing', 'approved']);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CARD_CHARGE_APPROVED' }));
  });

  it('a wrong PIN or too little money puts the charge back, so the holder can retry', async () => {
    const { service, fake } = setup(handlers(), { payFails: new BadRequestException('Solde ScanLinkPay insuffisant') });
    await expect(service.approve(USER, 'ch1', '1234')).rejects.toThrow(/insuffisant/);
    expect(statuses(fake)).toEqual(['processing', 'pending']);
  });

  it('every attempt has its own idempotency key (a failed attempt is never replayed as the next one)', async () => {
    const { service, payments } = setup(handlers());
    await service.approve(USER, 'ch1', '1234');
    await service.approve(USER, 'ch1', '1234');
    const keys = payments.payWithWallet.mock.calls.map((c: any[]) => c[3]);
    expect(new Set(keys).size).toBe(2);
  });

  it('two approvals at once: the second does not pay', async () => {
    const { service, payments } = setup(handlers({ claim: null }));
    await expect(service.approve(USER, 'ch1', '1234')).rejects.toBeInstanceOf(ConflictException);
    expect(payments.payWithWallet).not.toHaveBeenCalled();
  });

  it("somebody else's charge looks like it does not exist", async () => {
    const { service, payments } = setup(handlers());
    await expect(service.approve('someone-else', 'ch1', '1234')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.decline('someone-else', 'ch1')).rejects.toBeInstanceOf(NotFoundException);
    expect(payments.payWithWallet).not.toHaveBeenCalled();
  });

  it('refuses an expired charge, a paused card and an already-closed charge', async () => {
    const late = { ...CHARGE, expires_at: new Date(Date.now() - 1000).toISOString() };
    const { service: s1, payments: p1 } = setup(handlers({ charge: late }));
    await expect(s1.approve(USER, 'ch1', '1234')).rejects.toThrow(/expiré/);
    expect(p1.payWithWallet).not.toHaveBeenCalled();
    await expect(setup(handlers({ card: { ...CARD, status: 'frozen' } })).service.approve(USER, 'ch1', '1234')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(setup(handlers({ charge: { ...CHARGE, status: 'declined' } })).service.approve(USER, 'ch1', '1234')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('an already paid charge answers "approved" without charging again', async () => {
    const h = handlers();
    h['payment_requests:select'] = () => ({ data: { status: 'PAID', link_token: 'lt' } });
    const { service, payments } = setup(h);
    await expect(service.approve(USER, 'ch1', '1234')).resolves.toEqual({ status: 'approved' });
    expect(payments.payWithWallet).not.toHaveBeenCalled();
  });

  it('declining closes the charge and cancels the invoice', async () => {
    const { service, fake } = setup(handlers());
    await service.decline(USER, 'ch1');
    expect(statuses(fake)).toEqual(['declined']);
    expect(writes(fake, 'payment_requests', 'update')[0].calls.find((c) => c.method === 'update')!.args[0].status).toBe('CANCELLED');
  });
});

describe('the till follows the charge', () => {
  const CHARGE = { id: 'ch1', merchant_id: 'm1', payment_request_id: 'pr1', amount_cents: 50000, currency: 'CDF', status: 'pending', expires_at: new Date(Date.now() + 100_000).toISOString() };
  it('sees "approved" once the invoice is paid, "expired" when time runs out, and only for its own charges', async () => {
    const paid = setup({ 'card_charges:select': () => ({ data: CHARGE }), 'payment_requests:select': () => ({ data: { status: 'PAID' } }) });
    expect(await paid.service.getChargeForMerchant('m1', 'ch1')).toMatchObject({ status: 'approved' });
    const late = setup({ 'card_charges:select': () => ({ data: { ...CHARGE, expires_at: new Date(Date.now() - 1000).toISOString() } }), 'payment_requests:select': () => ({ data: { status: 'CREATED' } }) });
    expect(await late.service.getChargeForMerchant('m1', 'ch1')).toMatchObject({ status: 'expired' });
    expect(writes(late.fake, 'payment_requests', 'update')).toHaveLength(1);
    await expect(setup({ 'card_charges:select': () => ({ data: null }) }).service.getChargeForMerchant('m2', 'ch1')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('a charge being paid is not expired the second its time is up', async () => {
    const h = { 'card_charges:select': () => ({ data: { ...CHARGE, status: 'processing', expires_at: new Date(Date.now() - 60_000).toISOString() } }), 'payment_requests:select': () => ({ data: { status: 'PENDING' } }) };
    expect(await setup(h).service.getChargeForMerchant('m1', 'ch1')).toMatchObject({ status: 'processing' });
  });
  it('cannot cancel a charge that was paid', async () => {
    const h: Handlers = { 'card_charges:select': () => ({ data: CHARGE }), 'card_charges:update': () => ({ data: null }), 'payment_requests:select': () => ({ data: { status: 'PAID' } }) };
    await expect(setup(h).service.cancelCharge('m1', 'ch1')).rejects.toThrow(/déjà payé/);
  });
});

describe('scanning a card to send money', () => {
  it('gives a first name and the wallet number of an active card, nothing for any other', async () => {
    const ok = setup({ 'cards:select': () => ({ data: CARD }), wallets: () => ({ data: { wallet_number: 'LP-00000001' } }), profiles: () => ({ data: { full_name: 'Amina Kabongo' } }) });
    expect(await ok.service.resolveForSend(`https://x.cd/c/${TOKEN}`)).toEqual({ holder: 'Amina K.', wallet_number: 'LP-00000001' });
    await expect(setup({ 'cards:select': () => ({ data: { ...CARD, status: 'frozen' } }) }).service.resolveForSend(TOKEN)).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup().service.resolveForSend('garbage')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('card settings (set by the super admin, empty by default)', () => {
  const logo = 'data:image/png;base64,iVBORw0KGgo=';
  it('accepts a clean set and turns empty fields into "not printed"', () => {
    expect(validateCardSettings({ service_phone: ' +243 900 000 000 ', web_domain: 'ScanLinkPay.com', validity_years: 3, partner_logos: [{ name: 'M-Pesa', image: logo }] })).toEqual({
      service_phone: '+243 900 000 000', web_domain: 'scanlinkpay.com', validity_years: 3, partner_logos: [{ name: 'M-Pesa', image: logo }],
    });
    expect(validateCardSettings({ service_phone: '', web_domain: '' })).toMatchObject({ service_phone: null, web_domain: null, validity_years: 3, partner_logos: [] });
  });
  it.each([
    [{ web_domain: 'https://scanlinkpay.com' }], [{ web_domain: 'scanlinkpay.com/path' }], [{ web_domain: 'evil.com"><script>' }],
    [{ service_phone: 'call me' }], [{ validity_years: 0 }], [{ validity_years: 11 }], [{ validity_years: 2.5 }],
    [{ partner_logos: [{ name: 'x', image: 'data:image/svg+xml;base64,PHN2Zz4=' }] }],
    [{ partner_logos: [{ name: 'x', image: 'https://evil.example/logo.png' }] }],
    [{ partner_logos: [{ name: '', image: logo }] }],
    [{ partner_logos: Array.from({ length: 7 }, () => ({ name: 'x', image: logo })) }],
    [{ partner_logos: [{ name: 'x', image: `data:image/png;base64,${'A'.repeat(150_001)}` }] }],
  ])('refuses %j', (bad) => {
    expect(() => validateCardSettings(bad)).toThrow(BadRequestException);
  });
  it('saving is audited without dumping the images', async () => {
    const { service, audit } = setup({ card_settings: () => ({ data: null }) });
    await service.updateSettings('admin1', { service_phone: '+243900000000', partner_logos: [{ name: 'M-Pesa', image: logo }] });
    const logged = JSON.stringify(audit.log.mock.calls);
    expect(logged).toContain('CARD_SETTINGS_UPDATED');
    expect(logged).not.toContain('iVBORw0KGgo');
  });
});
