import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as express from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Route outbound HTTP requests through a fixed-IP proxy when PROXY_URL is set.
  // Needed on Render (shared outbound IPs) for CinetPay IP whitelisting —
  // set PROXY_URL to your QuotaGuard/Fixie proxy URL in Render env vars.
  // Logged (with credentials masked) so a "not whitelisted" error from
  // CinetPay is easy to tell apart from "the proxy isn't even configured".
  if (process.env.PROXY_URL) {
    setGlobalDispatcher(new ProxyAgent(process.env.PROXY_URL));
    logger.log(`Outbound requests routed via proxy: ${process.env.PROXY_URL.replace(/\/\/.*@/, '//***@')}`);
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
