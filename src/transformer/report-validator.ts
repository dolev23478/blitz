import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { Ajv, type ValidateFunction } from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import Ajv2019 from 'ajv/dist/2019.js';
import addFormats from 'ajv-formats';
import { TransformerErrorCode } from '../common/enums.js';
import { TransformerException } from '../common/exceptions.js';
import { provisionalRawReportSchema } from '../contracts/provisional-raw-report.schema.js';
import type { RawReport } from '../contracts/schema.js';

@Injectable()
export class ReportValidator {
  private readonly validateLocal: ValidateFunction<RawReport>;
  private readonly validateDE?: ValidateFunction;

  constructor(config: ConfigService) {
    const ajv = new Ajv({ allErrors: true });
    addFormats.default(ajv);
    this.validateLocal = ajv.compile<RawReport>(provisionalRawReportSchema);
    const schemaPath = config.get<string>('DE_RAW_REPORT_SCHEMA_PATH');
    if (schemaPath) {
      const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
      const dialect: string = schema.$schema ?? '';
      const contractAjv = dialect.includes('2020-12')
        ? new Ajv2020.default({ allErrors: true })
        : dialect.includes('2019-09')
          ? new Ajv2019.default({ allErrors: true })
          : new Ajv({ allErrors: true });
      addFormats.default(contractAjv);
      this.validateDE = contractAjv.compile(schema);
    } else
      new Logger(ReportValidator.name).warn(
        'Using provisional local RAW_REPORT rules; the DE JSON Schema is not configured.',
      );
  }

  validate(candidate: unknown): RawReport {
    if (!this.validateLocal(candidate)) {
      const issues = this.validateLocal.errors
        ?.map((issue) => `${issue.instancePath || '/'}: ${issue.keyword}`)
        .join(', ');
      throw new TransformerException(
        TransformerErrorCode.ValidationFailed,
        `Invalid RAW_REPORT fields: ${issues}`,
      );
    }
    if (/<\/?[a-z][^>]*>/i.test(candidate.content)) {
      throw new TransformerException(
        TransformerErrorCode.ValidationFailed,
        'Invalid parsed content.',
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
  serialize(candidate: unknown): string {
    const report = this.validate(candidate);
    const keys = [...provisionalRawReportSchema.required];
    if (report.media_urls?.length) keys.push('media_urls');
    return JSON.stringify(
      Object.fromEntries(
        keys.sort().map((key) => [key, report[key as keyof RawReport]]),
      ),
    );
  }
}
