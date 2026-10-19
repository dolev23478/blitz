import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

/** Validates and transforms a request body/query with a zod schema; failures become a 400 `{ error }`. */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(
    private readonly schema: S,
    private readonly message?: string,
  ) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) throw new BadRequestException(this.message ?? z.prettifyError(result.error));
    return result.data;
  }
}
