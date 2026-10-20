import {
  type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger, NotFoundException,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

/** Renders every error as `{ "error": "<message>" }`, the format the API and UI have always used. */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Api');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<FastifyReply>();
    if (res.sent) return;

    if (exception instanceof NotFoundException && /^Cannot [A-Z]+ /.test(exception.message)) {
      return void res.status(404).send({ error: 'Not found' });
    }
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const message =
        typeof body === 'string' ? body : ((body as { message?: string | string[] }).message ?? exception.message);
      return void res.status(exception.getStatus()).send({ error: Array.isArray(message) ? message.join('; ') : message });
    }
    // Errors raised by Fastify itself (bad content type, payload too large, ...) carry their own 4xx status.
    const { statusCode, message } = (exception ?? {}) as { statusCode?: number; message?: string };
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return void res.status(statusCode).send({ error: message ?? 'Bad request' });
    }
    this.logger.error(exception);
    res.status(500).send({ error: 'Internal server error' });
  }
}
