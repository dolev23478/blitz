import { createHash } from 'node:crypto';

/**
 * MVP identity derived from platform and unchanged URL, within the signed int32 contract.
 * Hash collisions are possible; this does not replace upstream unique ID allocation.
 */
export function reportId(platform: string, reportUrl: string): number {
  return createHash('sha256')
    .update(`${platform}:${reportUrl}`)
    .digest()
    .readInt32BE(0);
}
