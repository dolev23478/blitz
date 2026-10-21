import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CompletionProcessor } from './processors/completion.processor.js';
import { MappingProcessor } from './processors/mapping.processor.js';
import { ParsingProcessor } from './processors/parsing.processor.js';
import { PublishingProcessor } from './processors/publishing.processor.js';
import { ValidationProcessor } from './processors/validation.processor.js';
import { TransformerWorkflow } from './transformer.workflow.js';
import { TwitterMappingStrategy } from './strategies/twitter-mapping.strategy.js';
import { TelegramMappingStrategy } from './strategies/telegram-mapping.strategy.js';
import { RadioMappingStrategy } from './strategies/radio-mapping.strategy.js';
import { RedisModule } from '../redis/redis.module.js';
import { RedisRetryQueue } from './retry-queue.js';

@Module({
  imports: [ConfigModule, RedisModule],
  providers: [
    RedisRetryQueue,
    TwitterMappingStrategy,
    TelegramMappingStrategy,
    RadioMappingStrategy,
    ParsingProcessor,
    MappingProcessor,
    ValidationProcessor,
    PublishingProcessor,
    CompletionProcessor,
    TransformerWorkflow,
  ],
  exports: [TransformerWorkflow],
})
export class TransformerModule {}
