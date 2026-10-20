import { arabicNormalizer } from "./arabic-normalizer.js";
import { defaultNormalizer, DefaultNormalizer } from "./default-normalizer.js";
import { emojiNormalizer } from "./emoji-normalizer.js";
import { englishNormalizer } from "./english-normalizer.js";
import { farsiNormalizer } from "./farsi-normalizer.js";
import { hebrewNormalizer } from "./hebrew-normalizer.js";
import type { TextNormalizer } from "./types.js";

export const LANGUAGE_ALIASES = new Set<string>([
  "ar",
  "ara",
  "fa",
  "fas",
  "per",
  "en",
  "eng",
  "he",
  "heb",
  "iw",
  "em",
  "emoji",
  "emojis",
]);

export function resolveLanguageAlias(language: string): string {
  const key = language.trim().toLowerCase();
  if (key === "em" || key === "emojis") return "emoji";
  return key;
}

const dedicated = new Map<string, TextNormalizer>([
  ["ar", arabicNormalizer],
  ["ara", arabicNormalizer],
  ["fa", farsiNormalizer],
  ["fas", farsiNormalizer],
  ["per", farsiNormalizer],
  ["en", englishNormalizer],
  ["eng", englishNormalizer],
  ["he", hebrewNormalizer],
  ["heb", hebrewNormalizer],
  ["iw", hebrewNormalizer],
  ["emoji", emojiNormalizer],
  ["emojis", emojiNormalizer],
  ["em", emojiNormalizer],
]);

const fallbacks = new Map<string, TextNormalizer>();

export function registerNormalizer(normalizer: TextNormalizer): void {
  dedicated.set(normalizer.language.toLowerCase(), normalizer);
  LANGUAGE_ALIASES.add(normalizer.language.toLowerCase());
}

export function getNormalizer(language: string): TextNormalizer {
  const key = resolveLanguageAlias(language);
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
