import { Controller, Get, Inject, Param, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { MessageEventsService, type NewMessagesEvent } from '../events/message-events.service.js';
import { messageIdSchema, messageQuerySchema, type MessageQueryDto } from './messages.dto.js';
import { MessagesService, type MessagePage } from './messages.service.js';
import type { StoredMessage } from '../types.js';

@Controller('api/messages')
export class MessagesController {
  constructor(
    @Inject(MessagesService) private readonly messages: MessagesService,
    @Inject(MessageEventsService) private readonly events: MessageEventsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  list(@Query(new ZodPipe(messageQuerySchema)) query: MessageQueryDto): Promise<MessagePage> {
    return this.messages.list(query);
  }

  /** Server-Sent Events stream notifying clients when new messages are stored. */
  @Get('stream')
  stream(@Req() req: FastifyRequest, @Res() reply: FastifyReply): void {
    // Hijacked replies skip Fastify's hooks (including the CORS plugin), so the CORS header is set by hand.
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': this.config.CORS_ORIGIN,
    });
    res.write(': connected\n\n');
    const onMessages = (e: NewMessagesEvent) => res.write(`event: messages\ndata: ${JSON.stringify(e)}\n\n`);
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);
    const unsubscribe = this.events.subscribe(onMessages);
    req.raw.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  }

  @Get(':id')
  get(@Param('id', new ZodPipe(messageIdSchema, 'Invalid id')) id: number): Promise<StoredMessage> {
    return this.messages.get(id);
  }
}
