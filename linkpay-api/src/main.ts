import { ProxyAgent } from 'undici';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as express from 'express';
import { AppModule } from './app.module';

// CinetPay's SDK talks to exactly these hosts (sandbox + production) — see
// cinetpay.adapter.ts. Only requests to these get routed through the proxy;
// everything else (Supabase Auth/REST, etc.) must keep using the platform's
// normal outbound path.
const CINETPAY_HOSTS = ['api.cinetpay.net', 'api.cinetpay.co'];

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
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' || input instanceof URL ? input : input.url;
      const hostname = new URL(url).hostname;
      if (CINETPAY_HOSTS.includes(hostname)) {
        return originalFetch(input, { ...init, dispatcher: proxyAgent } as RequestInit);
      }
      return originalFetch(input, init);
    }) as typeof fetch;
    logger.log(`CinetPay requests (${CINETPAY_HOSTS.join(', ')}) routed via proxy: ${process.env.PROXY_URL.replace(/\/\/.*@/, '//***@')}`);
  } else {
    logger.warn('PROXY_URL not set — outbound requests use the raw platform IP (CinetPay IP whitelisting will fail on Render\'s shared IPs)');
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
  app.use(express.urlencoded({ extended: true }));

  app.use(helmet());
  const frontendUrl = configService.get<string>('FRONTEND_URL');
  const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:5176',
    'http://localhost:5177',
    'http://localhost:5178',
    'http://localhost:5179',
    'http://localhost:5180',
  ];
  if (frontendUrl && !allowedOrigins.includes(frontendUrl)) {
    allowedOrigins.push(frontendUrl);
  }
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  app.setGlobalPrefix('api/v1', { exclude: ['health'] });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('LinkPay API')
    .setDescription('LinkPay Payment Platform REST API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/v1/docs', app, document);

  const port = configService.get<number>('PORT', 3000);
  await app.listen(port);
  logger.log(`LinkPay API running on port ${port}`);
  logger.log(`Swagger docs at http://localhost:${port}/api/v1/docs`);
}

bootstrap();
