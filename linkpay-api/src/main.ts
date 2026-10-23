import { ProxyAgent } from 'undici';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as express from 'express';
import { AppModule } from './app.module';
import { createCsrfMiddleware } from './auth/csrf.middleware';
import { configureTrustProxy, resolveTrustProxyHops } from './common/utils/trust-proxy';
import { startTrustedClock } from './common/utils/trusted-clock';

/**
 * FlexPaie is reached at the addresses its own contract gives (Mobile Money, card and status check can be different
 * hosts). Only requests to these go through the proxy; everything else (Supabase Auth/REST, etc.) keeps the
 * platform's normal outbound path.
 */
function flexPaieHosts(): string[] {
  const hosts = new Set<string>();
  for (const key of ['FLEXPAIE_BASE_URL', 'FLEXPAIE_MOMO_URL', 'FLEXPAIE_CARD_URL', 'FLEXPAIE_CHECK_URL', 'FLEXPAIE_PAYOUT_AUTH_URL', 'FLEXPAIE_PAYOUT_URL', 'FLEXPAIE_PAYOUT_CHECK_URL']) {
    try {
      if (process.env[key]) hosts.add(new URL(String(process.env[key]).trim()).hostname);
    } catch {
      /* a malformed address is reported by the adapter when it is used */
    }
  }
  return [...hosts];
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Route outbound HTTP requests through a fixed-IP proxy when PROXY_URL is
  // set — for a payment provider that only accepts a whitelisted IP (Render
  // shares outbound IPs). Scoped to FlexPaie's own hosts only: undici's
  // setGlobalDispatcher() would apply to EVERY outbound fetch in the
  // process, including the Supabase client's own calls (auth, REST) — that
  // previously broke login/signup once PROXY_URL was set, since Supabase
  // traffic got silently routed through a proxy that was never meant for
  // it. Wrapping globalThis.fetch instead lets us pick the dispatcher
  // per-request based on the destination host.
  if (process.env.PROXY_URL) {
    const proxyAgent = new ProxyAgent(process.env.PROXY_URL);
    const originalFetch = globalThis.fetch;
    const proxiedHosts = flexPaieHosts();
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' || input instanceof URL ? input : input.url;
      const hostname = new URL(url).hostname;
      if (proxiedHosts.includes(hostname)) {
        return originalFetch(input, { ...init, dispatcher: proxyAgent } as RequestInit);
      }
      return originalFetch(input, init);
    }) as typeof fetch;
    logger.log(`Payment provider requests (${flexPaieHosts().join(', ')}) routed via proxy: ${process.env.PROXY_URL.replace(/\/\/.*@/, '//***@')}`);
  } else {
    logger.log('PROXY_URL not set — outbound requests use the platform IP (FlexPaie does not require a fixed IP)');
  }

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    // Body parsing is wired manually below so PSP webhook handlers can access
    // the raw request buffer (req.rawBody) for signature verification —
    // Nest's default bodyParser only exposes the already-parsed JSON object.
    bodyParser: false,
  });
  const configService = app.get(ConfigService);

  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(
    express.urlencoded({
      extended: true,
      // A provider may post its callback as a form: the adapter reads it from the raw body like the JSON ones.
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  // The rate limiter keys on the client IP: behind Render's proxy it needs the
  // real one (see common/utils/trust-proxy.ts).
  const trustProxyHops = resolveTrustProxyHops({
    NODE_ENV: configService.get<string>('NODE_ENV'),
    TRUST_PROXY_HOPS: configService.get<string>('TRUST_PROXY_HOPS'),
  });
  configureTrustProxy(app.getHttpAdapter().getInstance(), trustProxyHops);

  app.use(helmet());
  const frontendUrl = configService.get<string>('FRONTEND_URL');
  const allowedOrigins = [
    // Any local dev/preview port on localhost or 127.0.0.1 — Vite picks
    // 5173+ and browser-preview proxies use ephemeral ports, so matching
    // by host instead of an enumerated port list keeps local login working.
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
    // Capacitor's Android WebView serves the bundled app from this origin.
    'https://localhost',
  ];
  if (frontendUrl && !allowedOrigins.includes(frontendUrl)) {
    allowedOrigins.push(frontendUrl);
  }
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });
  // Cookie sessions (COOKIE_AUTH=true): refuse forged cross-site requests. Bearer-token clients pass straight through.
  app.use(createCsrfMiddleware(allowedOrigins));

  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // The interactive API docs list every route and DTO: handy in development,
  // a free map of the attack surface in production. Opt in with ENABLE_SWAGGER=true.
  const swaggerEnabled =
    configService.get<string>('NODE_ENV') !== 'production' || configService.get<string>('ENABLE_SWAGGER') === 'true';
  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('ScanLinkPay API')
      .setDescription('ScanLinkPay Payment Platform REST API')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/v1/docs', app, document);
  }

  // Dating (paid_at, "today" on the dashboards) follows the cloud's clock, not a possibly wrong host clock.
  await startTrustedClock(configService.get<string>('SUPABASE_URL'), configService.get<string>('SUPABASE_SERVICE_ROLE_KEY'));

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);
  logger.log(`ScanLinkPay API running on port ${port}`);
  if (swaggerEnabled) logger.log(`Swagger docs at http://localhost:${port}/api/v1/docs`);
}

bootstrap();
