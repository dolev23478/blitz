import { Controller, Get, Post, Sse } from '@nestjs/common';
import { Observable, interval } from 'rxjs';
import type { KafkaAnalyticsSummary } from '@blitz/shared';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('snapshot')
  getSnapshot(): KafkaAnalyticsSummary {
    return this.analyticsService.getSnapshot();
  }

  @Post('reset')
  reset(): { success: boolean } {
    this.analyticsService.reset();
    return { success: true };
  }

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      // 1. Initial snapshot on connect
      const snapshot = this.analyticsService.getSnapshot();
      subscriber.next({
        data: JSON.stringify({
          type: 'snapshot',
          payload: snapshot,
        }),
      } as MessageEvent);

      // 2. Real-time updates subscription
      const unsubscribe = this.analyticsService.subscribe((event: unknown) => {
        subscriber.next({
          data: JSON.stringify(event),
        } as MessageEvent);
      });

      // 3. Heartbeat / demo stream generator
      const timer = interval(10000).subscribe(() => {
        this.analyticsService.createDemoTelemetryEvent();
      });

      return () => {
        unsubscribe();
        timer.unsubscribe();
      };
    });
  }
}
