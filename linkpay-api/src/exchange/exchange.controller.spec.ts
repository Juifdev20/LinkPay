import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ExchangeController, ExchangeAdminController } from './exchange.controller';
import { ExchangeService } from './exchange.service';
import { TwoFactorService } from '../security/two-factor.service';

/**
 * The HTTP door of the Bureau d'échange, with the same validation as production (main.ts): who may knock, what a
 * request must look like. The money logic itself is tested in exchange.service.spec.ts and on a real database.
 */
describe("Bureau d'échange — l'API HTTP", () => {
  let app: INestApplication;
  const service = {
    getState: jest.fn(async () => ({ enabled: true })),
    requestVerification: jest.fn(async () => ({ status: 'pending' })),
    createQuote: jest.fn(async () => ({ quote_id: 'q-1' })),
    execute: jest.fn(async () => ({ exchange: { reference: 'EX-000001' } })),
    adminOverview: jest.fn(async () => ({})),
    setRates: jest.fn(async () => ({})),
    setEnabled: jest.fn(async () => ({})),
    setLimits: jest.fn(async () => ({})),
    listVerifications: jest.fn(async () => []),
    approve: jest.fn(async () => ({ status: 'approved' })),
    reject: jest.fn(async () => ({ status: 'rejected' })),
    revoke: jest.fn(async () => ({ status: 'revoked' })),
  };
  const UUID = '8b3f1c2e-9d4a-4f6b-8a1e-2c3d4e5f6a7b';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ExchangeController, ExchangeAdminController],
      providers: [
        { provide: ExchangeService, useValue: service },
        // The step-up code is not what is tested here: it lets everything through.
        { provide: TwoFactorService, useValue: { isAdminRequirementPaused: async () => true, assertValid: async () => undefined } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    // Stand-in for the JWT guard: the caller is described by a header.
    app.use((req: any, _res: any, next: any) => {
      const raw = req.headers['x-test-user'];
      if (raw) req.user = JSON.parse(String(raw));
      next();
    });
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  const as = (role: string, extra: Record<string, any> = {}) => JSON.stringify({ id: 'u-1', role, ...extra });

  describe('côté client', () => {
    it('l\'état est demandé pour l\'utilisateur et son rôle', async () => {
      await request(app.getHttpServer()).get('/exchange').set('x-test-user', as('client')).expect(200);
      expect(service.getState).toHaveBeenCalledWith('u-1', 'client');
    });

    it('un patron qui agit au nom d\'un magasin garde son rôle de patron', async () => {
      await request(app.getHttpServer()).get('/exchange').set('x-test-user', as('merchant', { acting_as_org_id: 'org-1' })).expect(200);
      expect(service.getState).toHaveBeenCalledWith('u-1', 'enterprise');
    });

    it('l\'offre refuse un montant décimal, négatif, nul ou une devise inconnue', async () => {
      const post = (body: any) => request(app.getHttpServer()).post('/exchange/quotes').set('x-test-user', as('client')).send(body);
      await post({ from_currency: 'USD', to_currency: 'CDF', amount_cents: 10000 }).expect(201);
      await post({ from_currency: 'USD', to_currency: 'CDF', amount_cents: 100.5 }).expect(400);
      await post({ from_currency: 'USD', to_currency: 'CDF', amount_cents: -5 }).expect(400);
      await post({ from_currency: 'USD', to_currency: 'CDF', amount_cents: 0 }).expect(400);
      await post({ from_currency: 'EUR', to_currency: 'CDF', amount_cents: 100 }).expect(400);
      await post({ from_currency: 'USD', to_currency: 'CDF', amount_cents: 10000, rate: 99999 }).expect(400); // un taux envoyé par le client est refusé
      expect(service.createQuote).toHaveBeenCalledTimes(1);
    });

    it('l\'échange exige la clé d\'idempotence, un devis valide et un PIN de 4 à 6 chiffres', async () => {
      const post = (body: any, key?: string) => {
        const r = request(app.getHttpServer()).post('/exchange').set('x-test-user', as('client'));
        return (key ? r.set('Idempotency-Key', key) : r).send(body);
      };
      await post({ quote_id: UUID, pin: '1234' }).expect(400); // pas de clé
      await post({ quote_id: UUID, pin: '123' }, 'k1').expect(400); // PIN trop court
      await post({ quote_id: 'pas-un-uuid', pin: '1234' }, 'k1').expect(400);
      await post({ quote_id: UUID, pin: '1234', amount_cents: 1 }, 'k1').expect(400); // aucun montant ne vient du client
      expect(service.execute).not.toHaveBeenCalled();
      await post({ quote_id: UUID, pin: '1234' }, 'k1').expect(201);
      expect(service.execute).toHaveBeenCalledWith('u-1', 'client', { quote_id: UUID, pin: '1234' }, 'k1');
    });
  });

  describe('côté équipe', () => {
    const put = (path: string, role: string, body: any) => request(app.getHttpServer()).put(path).set('x-test-user', as(role)).send(body);
    const RATES = { buy_rate: 2820, sell_rate: 2880 };

    it('les taux ne se changent que par le super admin (ni client, ni admin simple)', async () => {
      await put('/admin/exchange/rates', 'client', RATES).expect(403);
      await put('/admin/exchange/rates', 'admin', RATES).expect(403);
      await put('/admin/exchange/rates', 'enterprise', RATES).expect(403);
      expect(service.setRates).not.toHaveBeenCalled();
      await put('/admin/exchange/rates', 'super_admin', RATES).expect(200);
      expect(service.setRates).toHaveBeenCalledWith('u-1', RATES);
    });

    it('les taux sont validés : 2 décimales au plus, positifs, taux du marché facultatif', async () => {
      await put('/admin/exchange/rates', 'super_admin', { buy_rate: 2820.123, sell_rate: 2880 }).expect(400);
      await put('/admin/exchange/rates', 'super_admin', { buy_rate: 0, sell_rate: 2880 }).expect(400);
      await put('/admin/exchange/rates', 'super_admin', { buy_rate: -1, sell_rate: 2880 }).expect(400);
      await put('/admin/exchange/rates', 'super_admin', { buy_rate: 2820, sell_rate: '2880' }).expect(400);
      await put('/admin/exchange/rates', 'super_admin', { ...RATES, market_rate: null }).expect(200);
      await put('/admin/exchange/rates', 'super_admin', { ...RATES, market_rate: 2850.5, confirm_large_change: true }).expect(200);
    });

    it('ouvrir / fermer le service et les limites : super admin seulement', async () => {
      await put('/admin/exchange/service', 'admin', { enabled: true }).expect(403);
      await put('/admin/exchange/service', 'super_admin', { enabled: 'oui' }).expect(400);
      await put('/admin/exchange/service', 'super_admin', { enabled: true }).expect(200);
      await put('/admin/exchange/limits/USD', 'admin', { daily_max_cents: 100000 }).expect(403);
      await put('/admin/exchange/limits/USD', 'super_admin', { daily_max_cents: 100000, min_cents: null }).expect(200);
      await put('/admin/exchange/limits/USD', 'super_admin', { daily_max_cents: 0 }).expect(400);
      await put('/admin/exchange/limits/USD', 'super_admin', { daily_max_cents: 10.5 }).expect(400);
    });

    it('les gains et les réglages ne sont pas visibles d\'un admin simple', async () => {
      await request(app.getHttpServer()).get('/admin/exchange/overview').set('x-test-user', as('admin')).expect(403);
      await request(app.getHttpServer()).get('/admin/exchange/overview').set('x-test-user', as('super_admin')).expect(200);
    });

    it('valider ou refuser un compte : admin ou super admin, jamais un client', async () => {
      const post = (path: string, role: string, body: any = {}) => request(app.getHttpServer()).post(path).set('x-test-user', as(role)).send(body);
      await post(`/admin/exchange/verifications/${UUID}/approve`, 'client').expect(403);
      await post(`/admin/exchange/verifications/${UUID}/approve`, 'admin').expect(201);
      expect(service.approve).toHaveBeenCalledWith('u-1', UUID);
      await post(`/admin/exchange/verifications/${UUID}/reject`, 'admin', { reason: 'Identité non vérifiée' }).expect(201);
      expect(service.reject).toHaveBeenCalledWith('u-1', UUID, 'Identité non vérifiée');
      await post('/admin/exchange/verifications/pas-un-uuid/approve', 'admin').expect(400);
      await request(app.getHttpServer()).get('/admin/exchange/verifications?status=pending').set('x-test-user', as('admin')).expect(200);
      expect(service.listVerifications).toHaveBeenCalledWith('pending');
      await request(app.getHttpServer()).get('/admin/exchange/verifications?status=nimporte').set('x-test-user', as('admin')).expect(200);
      expect(service.listVerifications).toHaveBeenLastCalledWith(undefined);
    });
  });
});
