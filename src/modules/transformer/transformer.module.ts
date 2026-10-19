import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { sourceMappings } from '../../config/source-mappings.js';
import { DeduplicationStore } from './deduplication.store.js';
import { CompletionProcessor } from './processors/completion.processor.js';
import { MappingProcessor } from './processors/mapping.processor.js';
import { ParsingProcessor } from './processors/parsing.processor.js';
import { PublishingProcessor } from './processors/publishing.processor.js';
import { ValidationProcessor } from './processors/validation.processor.js';
import { TransformerWorkflow } from './transformer.workflow.js';
import { JsonParsingStrategy } from './strategies/json-parsing.strategy.js';
import { HtmlParsingStrategy } from './strategies/html-parsing.strategy.js';
import { JsonMappingStrategy } from './strategies/json-mapping.strategy.js';
import { HtmlMappingStrategy } from './strategies/html-mapping.strategy.js';

@Module({
  imports: [ConfigModule.forRoot({ load: [() => ({ sourceMappings })] })],
  providers: [
    DeduplicationStore,
    JsonParsingStrategy,
    HtmlParsingStrategy,
    JsonMappingStrategy,
    HtmlMappingStrategy,
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
