import { createHash } from 'node:crypto';
import { INT32_MAX } from '../common/constants.js';

/**
 * Preserve supplied contract IDs; generate a deterministic non-negative int32 otherwise.
 * Hash collisions are possible; this does not replace upstream unique ID allocation.
 */
export function reportId(
  platform: string,
  reportUrl: string,
  supplied?: unknown,
): number {
  if (supplied !== undefined) {
    if (
      typeof supplied !== 'number' ||
      !Number.isInteger(supplied) ||
      supplied < 0 ||
      supplied > INT32_MAX
    )
      throw new Error(
        'Collector report_id must be an integer in [0, 2147483647].',
      );
    return supplied;
  }
  return (
    createHash('sha256')
      .update(`${platform}:${reportUrl}`)
      .digest()
      .readUInt32BE(0) & INT32_MAX
  );
}
