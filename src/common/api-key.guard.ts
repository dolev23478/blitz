import { timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

const PUBLIC_KEY = 'isPublic';

/** Marks a route as reachable without the API key (e.g. the health check). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Optional API-key auth: `Authorization: Bearer <key>`, `X-API-Key: <key>` or `?api_key=<key>` (for SSE). */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.API_KEY;
    if (!expected) return true;
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()])) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const query = req.query as { api_key?: unknown };
    const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const header = req.headers['x-api-key'];
    const provided = bearer ?? (typeof header === 'string' ? header : undefined) ?? (typeof query.api_key === 'string' ? query.api_key : '');
    if (provided && safeEqual(provided, expected)) return true;
    throw new UnauthorizedException('Missing or invalid API key');
  }
}
