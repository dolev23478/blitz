import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { State } from '../../common/enums.js';
import type { TransformContext } from '../transformer.types.js';
import { ReportValidator } from '../report-validator.js';

@Injectable()
export class ValidationProcessor {
  readonly stage = State.Validation;
  private readonly validator: ReportValidator;
  constructor(config: ConfigService) {
    this.validator = new ReportValidator(config);
  }
  async execute(context: TransformContext): Promise<void> {
    if (!context.candidates)
      throw new Error('Mapping must produce candidates before validation.');
    context.reports = context.candidates.map((candidate) =>
      this.validator.validate(candidate),
    );
  }
}
