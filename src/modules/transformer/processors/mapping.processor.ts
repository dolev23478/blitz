import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PayloadFormat,
  State,
  TransformerErrorCode,
} from '../../../common/enums.js';
import { TransformerException } from '../../../common/exceptions.js';
import type { TransformContext } from '../transformer.types.js';
import type { MappingDefinition } from '../../../contracts/mappings.js';
import { normalizeReport } from '../normalization.js';
import { HtmlMappingStrategy } from '../strategies/html-mapping.strategy.js';
import { JsonMappingStrategy } from '../strategies/json-mapping.strategy.js';

@Injectable()
export class MappingProcessor {
  readonly stage = State.Mapping;

  constructor(
    private readonly config: ConfigService,
    private readonly json: JsonMappingStrategy,
    private readonly html: HtmlMappingStrategy,
  ) {}

  async execute(context: TransformContext): Promise<void> {
    const { input, parsedData } = context;
    const definitions = this.config.get<MappingDefinition[]>(
      'sourceMappings',
      [],
    );
    const matches = definitions.filter(
      (definition) =>
        definition.source.id === input.source.id &&
        definition.source.version === input.source.version &&
        definition.format === input.payload.format,
    );
    if (matches.length !== 1) {
      throw new TransformerException(
        TransformerErrorCode.MappingFailed,
        'Exactly one trusted mapping is required for this source version and format.',
      );
    }
    try {
      const strategy =
        input.payload.format === PayloadFormat.Json ? this.json : this.html;
      const candidate: Record<string, unknown> = {};
      for (const [field, rule] of Object.entries(matches[0]!.fields)) {
        if (
          field === 'is_official' ||
          field === 'schema_version' ||
          ['__proto__', 'prototype', 'constructor'].includes(field)
        ) {
          throw new Error('Mapping cannot override protected fields.');
        }
        const value = strategy.read(parsedData, rule);
        if (value !== undefined) candidate[field] = value;
      }
      // Platform metadata is supplied by the collecting service, not an enum.
      if (candidate.platform === undefined)
        candidate.platform = input.source.platform;
      context.candidate = normalizeReport(candidate);
    } catch {
      throw new TransformerException(
        TransformerErrorCode.MappingFailed,
        'Source mapping or normalization failed.',
      );
    }
  }
}
