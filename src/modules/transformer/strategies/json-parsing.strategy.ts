import { Injectable } from '@nestjs/common';

export const MAX_PAYLOAD_BYTES = 1024 * 1024;

/** Reject unsafe numbers rather than silently publishing a rounded report ID. */
export function checkJson(value: unknown): void {
  const pending = [{ value, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;

  while (pending.length) {
    const item = pending.pop()!;
    if (++nodes > 10000 || item.depth > 64) {
      throw new Error('JSON payload exceeds the supported complexity.');
    }
    const current = item.value;
    if (typeof current === 'number') {
      if (
        !Number.isFinite(current) ||
        (Number.isInteger(current) && !Number.isSafeInteger(current))
      ) {
        throw new Error(
          'JSON contains a non-finite or unsafe numeric value. Send large IDs as strings.',
        );
      }
    } else if (current !== null && typeof current === 'object') {
      if (seen.has(current))
        throw new Error(
          'JSON must not contain circular/shared object references.',
        );
      seen.add(current);
      if (
        !Array.isArray(current) &&
        Object.getPrototypeOf(current) !== Object.prototype &&
        Object.getPrototypeOf(current) !== null
      ) {
        throw new Error('JSON must contain only plain objects and arrays.');
      }
      const keys = Reflect.ownKeys(current);
      if (nodes + pending.length + keys.length > 10000)
        throw new Error('Too many JSON fields.');
      for (const key of keys) {
        if (typeof key === 'symbol')
          throw new Error('JSON symbol keys are not supported.');
        const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
        if (descriptor.get || descriptor.set)
          throw new Error('JSON accessors are not supported.');
        pending.push({ value: descriptor.value, depth: item.depth + 1 });
      }
    } else if (
      current !== null &&
      typeof current !== 'string' &&
      typeof current !== 'boolean'
    ) {
      throw new Error('Payload contains a value that JSON cannot represent.');
    }
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new Error('JSON payload exceeds 1 MiB.');
  }
}

@Injectable()
export class JsonParsingStrategy {
  parse(data: unknown): unknown {
    if (
      typeof data === 'string' &&
      Buffer.byteLength(data, 'utf8') > MAX_PAYLOAD_BYTES
    ) {
      throw new Error('JSON payload exceeds 1 MiB.');
    }
    const parsed: unknown =
      typeof data === 'string'
        ? JSON.parse(
            data,
            (_key: string, value: unknown, context?: { source?: string }) => {
              // Do not accept a fractional/exponent token rounded into an integer ID.
              if (
                typeof value === 'number' &&
                Number.isInteger(value) &&
                context?.source &&
                /[.eE]/.test(context.source)
              ) {
                throw new Error(
                  'Integer values must use plain integer notation or strings.',
                );
              }
              return value;
            },
          )
        : data;
    checkJson(parsed);
    return typeof data === 'string' ? parsed : structuredClone(parsed);
  }
}
