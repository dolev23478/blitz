import { Controller, Get, HttpException, Inject, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe.js';
import { TelegramService, TelegramSourceError } from './telegram.service.js';

const idSchema = z.coerce.number().int().positive();

@Controller('api/media')
export class MediaController {
  constructor(@Inject(TelegramService) private readonly telegram: TelegramService) {}

  /** Media of a message collected through the Telegram account (downloaded on demand). */
  @Get(':channelId/:messageId')
  async get(
    @Param('channelId', new ZodPipe(idSchema, 'Invalid id')) channelId: number,
    @Param('messageId', new ZodPipe(idSchema, 'Invalid id')) messageId: number,
    @Res() res: FastifyReply,
  ): Promise<void> {
    try {
      const file = await this.telegram.downloadMedia(channelId, messageId);
      await res
        .header('Content-Type', file.mimeType ?? 'application/octet-stream')
        .header('Cache-Control', 'private, max-age=86400')
        .send(Buffer.from(file.data));
    } catch (err) {
      if (err instanceof TelegramSourceError) throw new HttpException(err.message, err.status);
      throw err;
    }
  }
}
