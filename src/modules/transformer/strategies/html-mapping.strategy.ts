import { Injectable } from '@nestjs/common';
import type { CheerioAPI } from 'cheerio';
import type { MappingRule } from '../../../contracts/mappings.js';

@Injectable()
export class HtmlMappingStrategy {
  read(data: unknown, rule: MappingRule): unknown {
    if (rule.kind === 'literal') return structuredClone(rule.value);
    if (
      rule.kind !== 'selector' ||
      typeof data !== 'function' ||
      !('root' in data)
    ) {
      throw new Error(
        'HTML mappings require a parsed document and selectors or literals.',
      );
    }
    const document = data as CheerioAPI;
    const elements = document(rule.selector);
    const extract = (index: number) =>
      rule.read.kind === 'text'
        ? elements.eq(index).text().trim()
        : elements.eq(index).attr(rule.read.name);
    return rule.cardinality === 'all'
      ? elements.toArray().map((_, index) => extract(index))
      : elements.length
        ? extract(0)
        : undefined;
  }
}
