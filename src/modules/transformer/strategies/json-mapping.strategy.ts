import { Injectable } from '@nestjs/common';
import type { MappingRule } from '../../../contracts/mappings.js';

@Injectable()
export class JsonMappingStrategy {
  read(data: unknown, rule: MappingRule): unknown {
    if (rule.kind === 'literal') return structuredClone(rule.value);
    if (rule.kind !== 'path')
      throw new Error('JSON mappings require paths or literals.');
    let value = data;
    for (const segment of rule.path) {
      if (['__proto__', 'constructor', 'prototype'].includes(String(segment))) {
        throw new Error('Unsafe mapping path.');
      }
      if (
        value === null ||
        typeof value !== 'object' ||
        !Object.hasOwn(value, segment)
      )
        return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, segment);
      if (!descriptor || descriptor.get || descriptor.set)
        throw new Error('Mapping accessors are not supported.');
      value = descriptor.value;
    }
    return value;
  }
}
