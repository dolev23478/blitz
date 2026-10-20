import { Controller, Get, Inject, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { Public } from '../common/api-key.guard.js';
import { KafkaAnalyticsService } from './kafka-analytics.service.js';
import type { KafkaAnalyticsSummary, KafkaStreamEvent } from './kafka-analytics.types.js';

@Controller('api/kafka/analytics')
export class KafkaAnalyticsController {
  constructor(
    @Inject(KafkaAnalyticsService) private readonly analytics: KafkaAnalyticsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Returns current statistics summary of Kafka stream and keyword filter.
   */
  @Public()
  @Get('stats')
  getStats(): KafkaAnalyticsSummary {
    return this.analytics.getSummary();
  }

  /**
   * Real-time Server-Sent Events (SSE) stream for Kafka publishes and keyword filter rejections.
   */
  @Public()
  @Get('stream')
  stream(@Req() req: FastifyRequest, @Res() reply: FastifyReply): void {
    reply.hijack();
    const res = reply.raw;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': this.config.CORS_ORIGIN || '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-API-Key',
    });

    res.write(': connected\n\n');

    // Send initial snapshot as first message so client has immediate state
    const initialStats = this.analytics.getSummary();
    res.write(`event: snapshot\ndata: ${JSON.stringify(initialStats)}\n\n`);

    const onEvent = (event: KafkaStreamEvent) => {
      try {
        res.write(`event: kafka_event\ndata: ${JSON.stringify(event)}\n\n`);
      } catch {
        // stream may have closed
      }
    };

    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        // stream closed
      }
    }, 20_000);

    const unsubscribe = this.analytics.subscribe(onEvent);

    req.raw.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  }

  /**
   * Endpoint to trigger simulated live events for testing UI visualizations.
   */
  @Public()
  @Post('simulate')
  simulate(@Query('count') count?: string): { simulated: KafkaStreamEvent[] } {
    const num = Math.min(Math.max(Number(count) || 1, 1), 20);
    const simulated: KafkaStreamEvent[] = [];
    for (let i = 0; i < num; i++) {
      simulated.push(this.analytics.simulateRandomEvent());
    }
    return { simulated };
  }

  /**
   * Resets the analytics state.
   */
  @Public()
  @Post('reset')
  reset(): { message: string } {
    this.analytics.reset();
    return { message: 'Kafka stream analytics reset to baseline.' };
  }
}
