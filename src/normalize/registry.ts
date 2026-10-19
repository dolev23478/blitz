import { arabicNormalizer } from "./arabic-normalizer.js";
import { defaultNormalizer, DefaultNormalizer } from "./default-normalizer.js";
import { englishNormalizer } from "./english-normalizer.js";
import { farsiNormalizer } from "./farsi-normalizer.js";
import type { TextNormalizer } from "./types.js";

const dedicated = new Map<string, TextNormalizer>([
  ["ar", arabicNormalizer],
  ["ara", arabicNormalizer],
  ["fa", farsiNormalizer],
  ["fas", farsiNormalizer],
  ["per", farsiNormalizer],
  ["en", englishNormalizer],
  ["eng", englishNormalizer],
]);

const fallbacks = new Map<string, TextNormalizer>();

export function registerNormalizer(normalizer: TextNormalizer): void {
  dedicated.set(normalizer.language.toLowerCase(), normalizer);
}

export function getNormalizer(language: string): TextNormalizer {
  const key = language.toLowerCase();
  const found = dedicated.get(key);
  if (found) {
    return found;
  }

  const cached = fallbacks.get(key);
  if (cached) {
    return cached;
  }

  const created = key === "default" ? defaultNormalizer : new DefaultNormalizer(key);
  fallbacks.set(key, created);
  return created;
}
