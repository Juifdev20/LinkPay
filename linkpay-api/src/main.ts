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

// CinetPay's SDK talks to exactly these hosts (sandbox + production) — see
// cinetpay.adapter.ts. Only requests to these get routed through the proxy;
// everything else (Supabase Auth/REST, etc.) must keep using the platform's
// normal outbound path.
const CINETPAY_HOSTS = ['api.cinetpay.net', 'api.cinetpay.co'];

/** FlexPaie is reached at an address its own contract gives (FLEXPAIE_BASE_URL); it too is usually reachable only from a whitelisted IP. */
function flexPaieHosts(): string[] {
  try {
    return process.env.FLEXPAIE_BASE_URL ? [new URL(process.env.FLEXPAIE_BASE_URL).hostname] : [];
  } catch {
    return [];
  }
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Route outbound HTTP requests through a fixed-IP proxy when PROXY_URL is
  // set — needed on Render (shared outbound IPs) for CinetPay IP
  // whitelisting. Scoped to CinetPay's own hosts only: undici's
  // setGlobalDispatcher() would apply to EVERY outbound fetch in the
  // process, including the Supabase client's own calls (auth, REST) — that
  // previously broke login/signup once PROXY_URL was set, since Supabase
  // traffic got silently routed through a proxy that was never meant for
  // it. Wrapping globalThis.fetch instead lets us pick the dispatcher
  // per-request based on the destination host.
  if (process.env.PROXY_URL) {
    const proxyAgent = new ProxyAgent(process.env.PROXY_URL);
    const originalFetch = globalThis.fetch;
    const proxiedHosts = [...CINETPAY_HOSTS, ...flexPaieHosts()];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' || input instanceof URL ? input : input.url;
      const hostname = new URL(url).hostname;
      if (proxiedHosts.includes(hostname)) {
        return originalFetch(input, { ...init, dispatcher: proxyAgent } as RequestInit);
      }
      return originalFetch(input, init);
    }) as typeof fetch;
    logger.log(`Payment provider requests (${[...CINETPAY_HOSTS, ...flexPaieHosts()].join(', ')}) routed via proxy: ${process.env.PROXY_URL.replace(/\/\/.*@/, '//***@')}`);
  } else {
    logger.warn('PROXY_URL not set — outbound requests use the raw platform IP (CinetPay / FlexPaie IP whitelisting will fail on Render\'s shared IPs)');
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

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);
  logger.log(`ScanLinkPay API running on port ${port}`);
  if (swaggerEnabled) logger.log(`Swagger docs at http://localhost:${port}/api/v1/docs`);
}

bootstrap();
