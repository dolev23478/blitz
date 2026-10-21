import type { TextNormalizer } from "./types.js";
import {
  applyUnicode,
  collapseSpaces,
  getRepeatedCharVariants,
  punctuationToSpace,
  tokenizeNormalized,
} from "./shared.js";

/**
 * Conservative default used for any language without a dedicated normalizer.
 * Case folding is applied; morphology is not.
 */
export class DefaultNormalizer implements TextNormalizer {
  readonly language: string;

  constructor(language = "default") {
    this.language = language;
  }

  normalize(text: string): string {
    const unicode = applyUnicode(text);
    const lower = unicode.toLowerCase();
    return collapseSpaces(punctuationToSpace(lower));
  }

  tokenize(normalizedText: string): string[] {
    return tokenizeNormalized(normalizedText);
  }

  tokenVariants(token: string): string[] {
    return getRepeatedCharVariants(token);
  }
}

export const defaultNormalizer = new DefaultNormalizer();
