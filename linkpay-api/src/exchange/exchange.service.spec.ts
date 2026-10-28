import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { createFakeSupabase, RecordedQuery } from '../test-utils/fake-supabase';

const NOW = new Date().toISOString();
const SETTINGS = { id: 1, enabled: true, buy_rate: 2820, sell_rate: 2880, market_rate: 2850, rates_updated_at: NOW, rates_updated_by: 'admin-1' };
const WALLET = { id: 'w-1', user_id: 'u-1', status: 'ACTIVE' };
const EXCHANGE_ROW = {
  id: 'ex-1', reference: 'EX-000001', wallet_id: 'w-1', quote_id: 'q-1', from_currency: 'USD', to_currency: 'CDF',
  from_cents: 10000, to_cents: 28_200_000, rate: 2820, created_at: NOW,
};

type Overrides = Record<string, (q: RecordedQuery) => any>;

function setup(overrides: Overrides = {}, settings: any = SETTINGS) {
  const fake = createFakeSupabase((q) => {
    const custom = overrides[q.target];
    if (custom) return custom(q);
    switch (q.target) {
      case 'exchange_settings': return { data: settings };
      case 'exchange_limits': return { data: [{ currency: 'USD', min_cents: 100, max_cents: null, daily_max_cents: 100000, monthly_max_cents: null }, { currency: 'CDF', min_cents: 300000 }] };
      case 'exchange_verifications': return { data: { status: 'approved', reason: null, requested_at: NOW, decided_at: NOW } };
      case 'rpc:exchange_usage': return { data: [{ currency: 'USD', day_cents: 10000, month_cents: 20000 }, { currency: 'CDF', day_cents: 0, month_cents: 0 }] };
      default: return { data: null };
    }
  });
  const audit = { log: jest.fn(async () => undefined) };
  const notifications = { create: jest.fn(async () => undefined) };
  const alerts = { alert: jest.fn(async () => undefined) };
  const wallets = { getWalletByUserId: jest.fn(async () => WALLET), getBalances: jest.fn(async () => ({ CDF: 28_200_000, USD: 40000 })) };
  const pins = { verifyPin: jest.fn(async () => undefined) };
  const service = new ExchangeService(fake.service, audit as any, notifications as any, alerts as any, wallets as any, pins as any);
  return { service, fake, audit, notifications, alerts, wallets, pins };
}

describe("Bureau d'échange — ce que voit l'application", () => {
  it('un employé ne voit rien : ni bouton, ni taux, et on ne lit même pas son portefeuille', async () => {
    const { service, wallets } = setup();
    const state: any = await service.getState('u-1', 'caissier');
    expect(state).toMatchObject({ eligible: false, enabled: false, available: false });
    expect(state.rates).toBeUndefined();
    expect(wallets.getWalletByUserId).not.toHaveBeenCalled();
  });

  it('service coupé : pas de bouton (livré désactivé)', async () => {
    const { service } = setup({}, { ...SETTINGS, enabled: false });
    expect(await service.getState('u-1', 'client')).toMatchObject({ eligible: true, enabled: false, available: false });
  });

  it('taux pas mis à jour depuis plus de 24 h : le service se met en pause tout seul, sans montrer de taux', async () => {
    const stale = new Date(Date.now() - 25 * 3_600_000).toISOString();
    const { service } = setup({}, { ...SETTINGS, rates_updated_at: stale });
    const state: any = await service.getState('u-1', 'client');
    expect(state).toMatchObject({ enabled: true, paused: true, available: false, rates: null });
  });

  it('compte validé et taux à jour : les prix et ce qu\'il reste de la limite du jour', async () => {
    const { service } = setup();
    const state: any = await service.getState('u-1', 'merchant');
    expect(state.available).toBe(true);
    expect(state.rates).toMatchObject({ buy: 2820, sell: 2880 });
    expect(state.limits.USD).toMatchObject({ daily_max_cents: 100000, used_today_cents: 10000, min_cents: 100 });
    expect(state.verification.status).toBe('approved');
  });

  it('compte pas encore validé : le bouton existe mais l\'échange n\'est pas disponible', async () => {
    const { service } = setup({ exchange_verifications: () => ({ data: null }) });
    const state: any = await service.getState('u-1', 'client');
    expect(state).toMatchObject({ enabled: true, available: false });
    expect(state.verification.status).toBe('none');
  });
});

describe("Bureau d'échange — demande de validation du compte", () => {
  it('crée la demande et prévient l\'équipe, une seule fois', async () => {
    const { service, alerts, audit, fake } = setup({
      exchange_verifications: (q) => (q.calls.some((c) => c.method === 'upsert') ? { data: null } : { data: null }),
      profiles: () => ({ data: { full_name: 'Jean Mukendi', phone: '+243 97 000 000', email: 'j@t.cd' } }),
    });
    expect(await service.requestVerification('u-1', 'client')).toEqual({ status: 'pending' });
    expect(fake.queries.some((q) => q.target === 'exchange_verifications' && q.calls.some((c) => c.method === 'upsert'))).toBe(true);
    expect(alerts.alert).toHaveBeenCalledWith(expect.objectContaining({ audience: 'admins', body: expect.stringContaining('Jean Mukendi') }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'exchange_verification_requested' }));
  });

  it('déjà en attente ou déjà validé : rien n\'est renvoyé à l\'équipe', async () => {
    for (const status of ['pending', 'approved']) {
      const { service, alerts } = setup({ exchange_verifications: () => ({ data: { status, reason: null, requested_at: NOW, decided_at: null } }) });
      expect(await service.requestVerification('u-1', 'client')).toEqual({ status });
      expect(alerts.alert).not.toHaveBeenCalled();
    }
  });

  it('refusée il y a moins de 24 h : pas de nouvelle demande, avec le motif', async () => {
    const { service } = setup({ exchange_verifications: () => ({ data: { status: 'rejected', reason: 'Pièce illisible', requested_at: NOW, decided_at: NOW } }) });
    await expect(service.requestVerification('u-1', 'client')).rejects.toMatchObject({ response: { code: 'EXCHANGE_VERIFICATION_REFUSED_RECENTLY' } });
  });

  it('un employé ne peut pas demander', async () => {
    const { service } = setup();
    await expect(service.requestVerification('u-1', 'vendeur')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("Bureau d'échange — offre garantie 60 secondes", () => {
  it('transmet la demande à la base et rend l\'offre', async () => {
    const { service, fake } = setup({
      'rpc:create_exchange_quote': () => ({ data: { id: 'q-1', from_currency: 'USD', to_currency: 'CDF', from_cents: 10000, to_cents: 28_200_000, rate: 2820, expires_at: NOW } }),
    });
    const quote = await service.createQuote('u-1', 'client', { from_currency: 'USD', to_currency: 'CDF', amount_cents: 10000 });
    expect(quote).toMatchObject({ quote_id: 'q-1', to_cents: 28_200_000, rate: 2820, seconds: 60 });
    const call = fake.queries.find((q) => q.target === 'rpc:create_exchange_quote')!;
    expect(call.calls[0].args[0]).toMatchObject({ p_user: 'u-1', p_wallet: 'w-1', p_from: 'USD', p_to: 'CDF', p_from_cents: 10000 });
  });

  it('traduit les refus de la base en messages clairs', async () => {
    const refuse = (message: string) => setup({ 'rpc:create_exchange_quote': () => ({ error: { message } }) });
    await expect(refuse('EXCHANGE_NOT_VERIFIED').service.createQuote('u-1', 'client', { from_currency: 'USD', to_currency: 'CDF', amount_cents: 10000 }))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(refuse('EXCHANGE_DAILY:5000').service.createQuote('u-1', 'client', { from_currency: 'USD', to_currency: 'CDF', amount_cents: 10000 }))
      .rejects.toMatchObject({ response: { code: 'EXCHANGE_DAILY', remaining_cents: 5000 } });
  });

  it('un portefeuille suspendu ne peut pas échanger', async () => {
    const { service, wallets } = setup();
    wallets.getWalletByUserId.mockResolvedValueOnce({ ...WALLET, status: 'SUSPENDED' } as any);
    await expect(service.createQuote('u-1', 'client', { from_currency: 'USD', to_currency: 'CDF', amount_cents: 10000 })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("Bureau d'échange — l'échange", () => {
  const dto = { quote_id: 'q-1', pin: '1234' };

  it('vérifie le PIN AVANT de toucher à l\'argent, puis écrit le journal et prévient la personne', async () => {
    const order: string[] = [];
    const { service, pins, audit, notifications } = setup({
      exchanges: () => ({ data: null }),
      'rpc:execute_exchange': () => { order.push('rpc'); return { data: EXCHANGE_ROW }; },
    });
    pins.verifyPin.mockImplementation(async () => { order.push('pin'); });
    const result = await service.execute('u-1', 'client', dto, 'key-1');
    expect(order).toEqual(['pin', 'rpc']);
    expect(result.exchange).toMatchObject({ reference: 'EX-000001', to_cents: 28_200_000 });
    expect(result.balances).toEqual({ CDF: 28_200_000, USD: 40000 });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'exchange_done' }));
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'exchange_done', body: expect.stringContaining('100,00') }));
  });

  it('un mauvais PIN arrête tout : aucune opération sur l\'argent', async () => {
    const { service, pins, fake } = setup({ exchanges: () => ({ data: null }) });
    pins.verifyPin.mockRejectedValue(new BadRequestException('PIN incorrect'));
    await expect(service.execute('u-1', 'client', dto, 'key-1')).rejects.toThrow('PIN incorrect');
    expect(fake.queries.some((q) => q.target === 'rpc:execute_exchange')).toBe(false);
  });

  it('la même requête rejouée (coupure réseau) renvoie le même échange, sans PIN ni deuxième débit', async () => {
    const { service, pins, fake } = setup({ exchanges: () => ({ data: EXCHANGE_ROW }) });
    const result: any = await service.execute('u-1', 'client', dto, 'key-1');
    expect(result.replayed).toBe(true);
    expect(result.exchange.reference).toBe('EX-000001');
    expect(pins.verifyPin).not.toHaveBeenCalled();
    expect(fake.queries.some((q) => q.target === 'rpc:execute_exchange')).toBe(false);
  });

  it('une clé déjà utilisée pour un autre devis est refusée', async () => {
    const { service } = setup({ exchanges: () => ({ data: { ...EXCHANGE_ROW, quote_id: 'autre-devis' } }) });
    await expect(service.execute('u-1', 'client', dto, 'key-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('offre expirée : 409 avec un code que l\'application sait traiter (nouvelle offre)', async () => {
    const { service } = setup({ exchanges: () => ({ data: null }), 'rpc:execute_exchange': () => ({ error: { message: 'EXCHANGE_QUOTE_EXPIRED' } }) });
    await expect(service.execute('u-1', 'client', dto, 'key-1')).rejects.toMatchObject({ response: { code: 'EXCHANGE_QUOTE_EXPIRED' }, status: 409 });
  });

  it('solde insuffisant au moment de confirmer : message en dollars', async () => {
    const { service } = setup({
      exchanges: () => ({ data: null }),
      exchange_quotes: () => ({ data: { from_currency: 'USD' } }),
      'rpc:execute_exchange': () => ({ error: { message: 'Insufficient balance' } }),
    });
    await expect(service.execute('u-1', 'client', dto, 'key-1')).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_BALANCE', message: 'Solde insuffisant en dollars.' } });
  });

  it('un employé ne peut pas échanger, et le PIN n\'est même pas demandé', async () => {
    const { service, pins } = setup();
    await expect(service.execute('u-1', 'gerant', dto, 'key-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(pins.verifyPin).not.toHaveBeenCalled();
  });
});

describe("Bureau d'échange — réglages de l'équipe", () => {
  it('le prix d\'achat ne peut pas dépasser le prix de vente', async () => {
    const { service } = setup();
    await expect(service.setRates('admin-1', { buy_rate: 2900, sell_rate: 2800 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('le taux du marché doit se situer entre achat et vente', async () => {
    const { service } = setup();
    await expect(service.setRates('admin-1', { buy_rate: 2820, sell_rate: 2880, market_rate: 3000 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('une faute de frappe (28200 au lieu de 2820) demande une deuxième confirmation', async () => {
    const { service, fake } = setup();
    await expect(service.setRates('admin-1', { buy_rate: 28200, sell_rate: 28800 })).rejects.toMatchObject({ response: { code: 'EXCHANGE_RATE_BIG_CHANGE' } });
    expect(fake.queries.some((q) => q.target === 'exchange_settings' && q.calls.some((c) => c.method === 'update'))).toBe(false);
  });

  it('un écart achat/vente trop large demande aussi confirmation', async () => {
    const { service } = setup({}, { ...SETTINGS, buy_rate: null, sell_rate: null });
    await expect(service.setRates('admin-1', { buy_rate: 2000, sell_rate: 2800 })).rejects.toMatchObject({ response: { code: 'EXCHANGE_RATE_BIG_CHANGE' } });
  });

  it('des taux normaux sont enregistrés avec l\'historique, le journal et l\'alerte', async () => {
    const { service, fake, audit, alerts } = setup({ exchange_rate_history: () => ({ data: [] }), profiles: () => ({ data: [] }), 'rpc:exchange_stats': () => ({ data: [{}] }) });
    await service.setRates('admin-1', { buy_rate: 2830, sell_rate: 2890, market_rate: 2860 });
    const update = fake.queries.find((q) => q.target === 'exchange_settings' && q.calls.some((c) => c.method === 'update'))!;
    expect(update.calls.find((c) => c.method === 'update')!.args[0]).toMatchObject({ buy_rate: 2830, sell_rate: 2890, market_rate: 2860, rates_updated_by: 'admin-1' });
    expect(fake.queries.some((q) => q.target === 'exchange_rate_history' && q.calls.some((c) => c.method === 'insert'))).toBe(true);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'exchange_rates_updated' }));
    expect(alerts.alert).toHaveBeenCalledWith(expect.objectContaining({ excludeUserId: 'admin-1' }));
  });

  it('on ne peut pas ouvrir le service sans taux à jour', async () => {
    const { service } = setup({}, { ...SETTINGS, enabled: false, rates_updated_at: null, buy_rate: null, sell_rate: null });
    await expect(service.setEnabled('admin-1', true)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('les limites doivent rester cohérentes (minimum ≤ maximum ≤ jour ≤ mois)', async () => {
    const { service } = setup();
    await expect(service.setLimits('admin-1', 'USD', { min_cents: 500, max_cents: 100 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.setLimits('admin-1', 'USD', { max_cents: 50000, daily_max_cents: 10000 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.setLimits('admin-1', 'EUR', {})).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("Bureau d'échange — décisions sur les comptes", () => {
  it('refuser demande un motif, montré au client', async () => {
    const { service } = setup();
    await expect(service.reject('admin-1', 'u-1', '  ')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('valider prévient la personne et se retrouve dans le journal', async () => {
    const { service, notifications, audit } = setup({ exchange_verifications: () => ({ data: [{ user_id: 'u-1' }] }) });
    expect(await service.approve('admin-1', 'u-1')).toEqual({ status: 'approved' });
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u-1', type: 'exchange_verification' }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'exchange_verification_approved' }));
  });

  it('deux administrateurs qui cliquent en même temps : le second reçoit « déjà traité »', async () => {
    const { service, notifications } = setup({ exchange_verifications: () => ({ data: [] }) });
    await expect(service.approve('admin-2', 'u-1')).rejects.toBeInstanceOf(ConflictException);
    expect(notifications.create).not.toHaveBeenCalled();
  });
});
