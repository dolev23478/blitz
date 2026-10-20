import type { TextNormalizer } from "./types.js";
import {
  collapseSpaces,
  punctuationToSpace,
  tokenizeNormalized,
} from "./shared.js";

const VARIATION_SELECTOR = /\uFE0F/g;

/**
 * Normalizer for emojis and pictographs.
 * Normalizes variation selectors (\uFE0F) and provides variant lookups
 * with and without variation selectors.
 */
export class EmojiNormalizer implements TextNormalizer {
  readonly language = "emoji";

  normalize(text: string): string {
    const withoutVs = text.replace(VARIATION_SELECTOR, "");
    return collapseSpaces(punctuationToSpace(withoutVs));
  }

  tokenize(normalizedText: string): string[] {
    return tokenizeNormalized(normalizedText);
  }

  tokenVariants(token: string): string[] {
    const clean = token.replace(VARIATION_SELECTOR, "");
    const withVs = clean + "\uFE0F";
    const res = new Set<string>([token, clean, withVs]);
    return [...res];
  }
}

export const emojiNormalizer = new EmojiNormalizer();
