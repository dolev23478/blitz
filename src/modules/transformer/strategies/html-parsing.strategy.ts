import { Injectable } from '@nestjs/common';
import { load } from 'cheerio';
import { MAX_PAYLOAD_BYTES } from './json-parsing.strategy.js';

@Injectable()
export class HtmlParsingStrategy {
  parse(data: unknown) {
    if (
      typeof data !== 'string' ||
      Buffer.byteLength(data, 'utf8') > MAX_PAYLOAD_BYTES
    ) {
      throw new Error('HTML must be a string of at most 1 MiB.');
    }
    // Cheerio parses locally: it does not execute scripts or fetch resources.
    const document = load(data);
    document('script, style, template, noscript').remove();
    document('br').replaceWith('\n');
    document('p, div, li, section, article, h1, h2, h3').append('\n');
    return document;
  }
}
