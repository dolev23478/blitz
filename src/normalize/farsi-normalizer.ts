import type { TextNormalizer } from "./types.js";
import {
  applyUnicode,
  collapseSpaces,
  getRepeatedCharVariants,
  punctuationToSpace,
  tokenizeNormalized,
} from "./shared.js";

const TATWEEL = /\u0640/g;
const DIACRITICS =
  /[\u064B-\u065F\u0670\u06D6-\u06ED\u08D3-\u08E1\u08E3-\u08FF]/g;
const COMBINING_MARKS = /\p{M}+/gu;

const ALEF_VARIANTS = /[أإآٱ]/g;
const ARABIC_KAF = /ك/g;
const ARABIC_YEH_VARIANTS = /[يىئ]/g;
const TAA_MARBUTA = /ة/g;
const WAW_HAMZA = /ؤ/g;
const HEH_VARIANTS = /[ھە]/g;
const ZWNJ = /\u200C/g;

export function foldFarsiLetters(text: string): string {
  return text
    .replace(TATWEEL, "")
    .replace(DIACRITICS, "")
    .replace(COMBINING_MARKS, "")
    .replace(ALEF_VARIANTS, "ا")
    .replace(ARABIC_KAF, "ک")
    .replace(ARABIC_YEH_VARIANTS, "ی")
    .replace(TAA_MARBUTA, "ه")
    .replace(WAW_HAMZA, "و")
    .replace(HEH_VARIANTS, "ه")
    .replace(ZWNJ, "");
}

const SUFFIXES = [
  "هایشان",
  "هایمان",
  "هایتان",
  "هایش",
  "هایم",
  "هایت",
  "های",
  "ها",
  "شان",
  "مان",
  "تان",
  "ترین",
  "تر",
  "آمیز",
  "امیز",
  "گرایی",
  "گرا",
  "سازی",
  "ات",
  "ان",
  "ای",
  "ی",
  "ش",
  "ت",
  "م",
];

/**
 * Everyday words that only look like affix + dictionary term (بازار = ب + آزار, میگه = می + گه).
 * They are matched as-is and never affix-stripped. Stored folded (see foldFarsiLetters).
 */
const NO_AFFIX_STRIP = new Set<string>(
  [
    "بازار", "بازارها", "بازاری",
    "بخون", "بخونم", "بخونی", "بخونه", "بخونیم", "بخونید", "بخونش",
    "میخونم", "میخونی", "میخونه", "میخونیم", "میخونید", "میخونن",
    "میگه", "بگه", "نمیگه",
    "مهاجرت", "مهاجرین", "بسمت", "جودی", "مینی", "جعلی", "خاکستری",
  ].map(foldFarsiLetters),
);

const PREFIXES = ["نمی", "می", "بی", "غیر", "ضد", "ب"];
const VERBAL_PREFIXES = ["نمی", "می", "ب"];
const VERBAL_SUFFIXES = ["ند", "ید", "یم", "د", "م", "ت"];

function stripAffixes(token: string): string[] {
  const stems = new Set<string>();

  const addIfLongEnough = (value: string, minLen = 2): void => {
    if (value.length >= minLen && value !== token) {
      stems.add(value);
    }
  };

  for (const suffix of SUFFIXES) {
    const minLen = suffix.length === 1 ? 3 : 2;
    if (token.endsWith(suffix) && token.length - suffix.length >= minLen) {
      const stem = token.slice(0, token.length - suffix.length);
      addIfLongEnough(stem, minLen);
      if (suffix === "ات" && stem.length >= 2) {
        addIfLongEnough(stem + "ه", 3);
      }
    }
  }

  for (const prefix of PREFIXES) {
    const minLen = prefix === "ب" ? 3 : 2;
    if (token.startsWith(prefix) && token.length - prefix.length >= minLen) {
      const withoutPrefix = token.slice(prefix.length);
      addIfLongEnough(withoutPrefix, minLen);
      for (const suffix of SUFFIXES) {
        const minLenS = suffix.length === 1 ? 3 : 2;
        if (
          withoutPrefix.endsWith(suffix) &&
          withoutPrefix.length - suffix.length >= minLenS
        ) {
          const stemBoth = withoutPrefix.slice(
            0,
            withoutPrefix.length - suffix.length,
          );
          addIfLongEnough(stemBoth, minLenS);
          if (suffix === "ات" && stemBoth.length >= 2) {
            addIfLongEnough(stemBoth + "ه", 3);
          }
        }
      }
    }
  }

  for (const prefix of VERBAL_PREFIXES) {
    if (token.startsWith(prefix) && token.length - prefix.length >= 2) {
      const rest = token.slice(prefix.length);
      addIfLongEnough(rest, 2);
      for (const suffix of VERBAL_SUFFIXES) {
        if (rest.endsWith(suffix) && rest.length - suffix.length >= 2) {
          addIfLongEnough(rest.slice(0, rest.length - suffix.length), 2);
        }
      }
    }
  }

  return [...stems];
}

/**
 * Farsi / Persian normalizer pipeline.
 * Handles Persian letter variants, ZWNJ stripping, diacritics removal,
 * and morphological affix stripping for high-recall dictionary matching.
 */
export class FarsiNormalizer implements TextNormalizer {
  readonly language = "fa";

  normalize(text: string): string {
    const unicode = applyUnicode(text);
    const folded = foldFarsiLetters(unicode);
    const lower = folded.toLowerCase();
    return collapseSpaces(punctuationToSpace(lower));
  }

  tokenize(normalizedText: string): string[] {
    return tokenizeNormalized(normalizedText);
  }

  tokenVariants(token: string): string[] {
    const baseTokens = getRepeatedCharVariants(token);
    const variants = new Set<string>(baseTokens);
    for (const b of baseTokens) {
      if (NO_AFFIX_STRIP.has(b)) {
        continue;
      }
      for (const stem of stripAffixes(b)) {
        variants.add(stem);
      }
    }
    return [...variants];
  }
}

export const farsiNormalizer = new FarsiNormalizer();
