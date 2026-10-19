import { Injectable } from '@nestjs/common';
import { State, TransformerErrorCode } from '../../common/enums.js';
import { TransformerException } from '../../common/exceptions.js';
import { isRecord } from '../../common/utils.js';
import type { TransformContext } from '../transformer.types.js';
import { checkJson } from '../json-input.js';

@Injectable()
export class ParsingProcessor {
  readonly stage = State.Parsing;

  /** The collector has already parsed JSON; only check and snapshot the object. */
  async execute(context: TransformContext): Promise<void> {
    try {
      checkJson(context.input);
      checkJson(context.metadata);
      if (
        !isRecord(context.input) ||
        !isRecord(context.metadata) ||
        typeof context.metadata.language !== 'string' ||
        !context.metadata.language.trim() ||
        (context.metadata.matches !== undefined &&
          (!Array.isArray(context.metadata.matches) ||
            !context.metadata.matches.every(
              (match) => typeof match === 'string',
            )))
      )
        throw new Error('Invalid collector object or report metadata.');
      context.input = structuredClone(context.input);
      context.metadata = structuredClone(context.metadata);
    } catch {
      throw new TransformerException(
        TransformerErrorCode.ParsingFailed,
        'Expected one bounded collector JSON object and valid report metadata.',
      );
    }
  }
}
