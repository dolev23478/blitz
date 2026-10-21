import { Global, Module } from '@nestjs/common';
import { KafkaAnalyticsService } from './kafka-analytics.service.js';
import { KafkaAnalyticsController } from './kafka-analytics.controller.js';

@Global()
@Module({
  controllers: [KafkaAnalyticsController],
  providers: [KafkaAnalyticsService],
  exports: [KafkaAnalyticsService],
})
export class KafkaAnalyticsModule {}
