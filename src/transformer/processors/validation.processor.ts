import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { Ajv, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { State, TransformerErrorCode } from '../../common/enums.js';
import { TransformerException } from '../../common/exceptions.js';
import { provisionalRawReportSchema } from '../../contracts/provisional-raw-report.schema.js';
import type { RawReport, RawReportCandidate } from '../../contracts/schema.js';
import type { TransformContext } from '../transformer.types.js';

@Injectable()
export class ValidationProcessor {
  readonly stage = State.Validation;
  private readonly validateLocal: ValidateFunction<RawReport>;
  private readonly validateDE?: ValidateFunction;
  private readonly languages = new Intl.DisplayNames(['en'], {
    type: 'language',
    fallback: 'none',
  });

  constructor(config: ConfigService) {
    const ajv = new Ajv({ allErrors: true });
    addFormats.default(ajv);
    this.validateLocal = ajv.compile<RawReport>(provisionalRawReportSchema);
    const schemaPath = config.get<string>('DE_RAW_REPORT_SCHEMA_PATH');
    if (schemaPath)
      this.validateDE = ajv.compile(
        JSON.parse(readFileSync(schemaPath, 'utf8')),
      );
    else
      new Logger(ValidationProcessor.name).warn(
        'Using provisional local RAW_REPORT rules; the DE JSON Schema is not configured.',
      );
  }

  async execute(context: TransformContext): Promise<void> {
    if (!context.candidates)
      throw new Error('Mapping must produce candidates before validation.');
    // Validate the entire response before publishing any of its reports.
    context.reports = context.candidates.map((candidate) =>
      this.validate(candidate),
    );
  }

  private validate(candidate: RawReportCandidate): RawReport {
    if (!this.validateLocal(candidate)) {
      const issues = this.validateLocal.errors
        ?.map((issue) => `${issue.instancePath || '/'}: ${issue.keyword}`)
        .join(', ');
      throw new TransformerException(
        TransformerErrorCode.ValidationFailed,
        `Invalid RAW_REPORT fields: ${issues}`,
      );
    }
    const id = BigInt(candidate.report_id);
    if (
      id < -(2n ** 63n) ||
      id > 2n ** 63n - 1n ||
      /<\/?[a-z][^>]*>/i.test(candidate.content) ||
      !this.languages.of(candidate.language)
    ) {
      throw new TransformerException(
        TransformerErrorCode.ValidationFailed,
        'Invalid report ID, parsed content or language code.',
      );
    }
    if (this.validateDE && !this.validateDE(candidate)) {
      throw new TransformerException(
        TransformerErrorCode.ValidationFailed,
        'RAW_REPORT does not satisfy the configured DE contract.',
      );
    }
    return candidate;
  }
}
