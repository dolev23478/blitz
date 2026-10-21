import 'reflect-metadata';
import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';

async function bootstrap(): Promise<void> {
  // debug lines (state hydration, peer cache) are hidden in production; set LOG_DEBUG=1 to see them.
  const showDebug = process.env.NODE_ENV !== 'production' || process.env.LOG_DEBUG === '1';
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    bodyParser: false,
    logger: showDebug ? ['log', 'warn', 'error', 'debug'] : ['log', 'warn', 'error'],
  });
  const config = app.get<AppConfig>(APP_CONFIG);
  const fastify = app.getHttpAdapter().getInstance();

  // Own JSON parser: accepts empty bodies (e.g. DELETE / bodiless POST sent with a JSON content type) and reports bad JSON as a 400.
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body) return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }), undefined);
    }
  });

  app.enableCors({
    origin: config.CORS_ORIGIN,
    methods: 'GET,POST,PATCH,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Authorization,X-API-Key',
  });
  app.enableShutdownHooks();

  await app.listen(config.PORT, '0.0.0.0');
  new Logger('Api').log(`http://localhost:${config.PORT}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
