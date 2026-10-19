import { Injectable } from '@nestjs/common';
import {
  PayloadFormat,
  State,
  TransformerErrorCode,
} from '../../../common/enums.js';
import { TransformerException } from '../../../common/exceptions.js';
import type { TransformContext } from '../transformer.types.js';
import { HtmlParsingStrategy } from '../strategies/html-parsing.strategy.js';
import { JsonParsingStrategy } from '../strategies/json-parsing.strategy.js';

@Injectable()
export class ParsingProcessor {
  readonly stage = State.Parsing;

  constructor(
    private readonly json: JsonParsingStrategy,
    private readonly html: HtmlParsingStrategy,
  ) {}

  async execute(context: TransformContext): Promise<void> {
    const { input } = context;
    try {
      switch (input.payload.format) {
        case PayloadFormat.Json:
          context.parsedData = this.json.parse(input.payload.data);
          break;
        case PayloadFormat.Web:
          context.parsedData = this.html.parse(input.payload.data);
          break;
        default:
          throw new TransformerException(
            TransformerErrorCode.UnsupportedFormat,
            'Unsupported payload format.',
          );
      }
    } catch (error) {
      if (error instanceof TransformerException) throw error;
      throw new TransformerException(
        TransformerErrorCode.ParsingFailed,
        'Payload could not be parsed safely.',
      );
    }
  }
}
