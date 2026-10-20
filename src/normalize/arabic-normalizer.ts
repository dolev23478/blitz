import type { TextNormalizer } from "./types.js";
import {
  applyUnicode,
  collapseSpaces,
  punctuationToSpace,
  tokenizeNormalized,
} from "./shared.js";

const TATWEEL = /\u0640/g;
const ARABIC_DIACRITICS =
  /[\u064B-\u065F\u0670\u06D6-\u06ED\u08D3-\u08E1\u08E3-\u08FF]/g;
const COMBINING_MARKS = /\p{M}+/gu;

const ALEF_VARIANTS = /[أإآٱ]/g;
const TAA_MARBUTA = /ة/g;
const ALEF_MAQSURA = /ى/g;
const WAW_HAMZA = /ؤ/g;
const YAA_HAMZA = /ئ/g;

/**
 * Longest-first clitics. Applied only as lookup variants, never by rewriting
 * the original token, to keep false positives in check.
 */
const PREFIXES = ["وال", "فال", "بال", "كال", "لل", "ال", "و", "ف", "ب", "ل", "ك", "س"];
const SUFFIXES = ["هما", "كما", "هم", "هن", "كم", "كن", "نا", "ني", "ها", "وا", "ون", "ين", "ات", "ه", "ك", "ي"];

const MIN_STEM_LENGTH = 3;

const ARABIZI_DIGITS: Record<string, string> = {
  "2": "ا",
  "3": "ع",
  "5": "خ",
  "6": "ط",
  "7": "ح",
  "8": "ق",
  "9": "ص",
};

const ARABIZI_VOWELS = new Set(["a", "e", "i", "o", "u"]);

const ARABIZI_DIGRAPHS: Array<[RegExp, string]> = [
  [/kh/g, "خ"],
  [/sh/g, "ش"],
  [/th/g, "ث"],
  [/dh/g, "ذ"],
  [/gh/g, "غ"],
  [/aa/g, "ا"],
  [/ee/g, "ي"],
  [/ii/g, "ي"],
  [/oo/g, "و"],
  [/ou/g, "و"],
];

const ARABIZI_LETTERS: Record<string, string> = {
  a: "ا",
  b: "ب",
  c: "ك",
  d: "د",
  e: "ي",
  f: "ف",
  g: "ج",
  h: "ه",
  i: "ي",
  j: "ج",
  k: "ك",
  l: "ل",
  m: "م",
  n: "ن",
  o: "و",
  p: "ب",
  q: "ق",
  r: "ر",
  s: "س",
  t: "ت",
  u: "و",
  v: "ف",
  w: "و",
  x: "كس",
  y: "ي",
  z: "ز",
};

function foldArabicLetters(text: string): string {
  return text
    .replace(TATWEEL, "")
    .replace(ARABIC_DIACRITICS, "")
    .replace(COMBINING_MARKS, "")
    .replace(ALEF_VARIANTS, "ا")
    .replace(TAA_MARBUTA, "ه")
    .replace(ALEF_MAQSURA, "ي")
    .replace(WAW_HAMZA, "و")
    .replace(YAA_HAMZA, "ي");
}

function looksLikeArabizi(token: string): boolean {
  return /[a-z]/i.test(token) && !/\p{Script=Arabic}/u.test(token);
}

function convertArabizi(token: string): string[] {
  if (!looksLikeArabizi(token)) {
    return [];
  }

  let output = token.toLowerCase();
  for (const [pattern, replacement] of ARABIZI_DIGRAPHS) {
    output = output.replace(pattern, replacement);
  }

  let vocalized = "";
  let skeleton = "";
  for (const char of output) {
    if (ARABIZI_VOWELS.has(char)) {
      vocalized += ARABIZI_LETTERS[char] ?? "";
      continue;
    }
    const mapped = ARABIZI_DIGITS[char] ?? ARABIZI_LETTERS[char] ?? char;
    vocalized += mapped;
    skeleton += mapped;
  }

  const results: string[] = [];
  for (const candidate of [vocalized, skeleton]) {
    const folded = foldArabicLetters(candidate);
    if (folded.length >= MIN_STEM_LENGTH && /\p{Script=Arabic}/u.test(folded)) {
      results.push(folded);
    }
  }
  return results;
}

function stripAffixes(token: string): string[] {
  const stems = new Set<string>();

  const addIfLongEnough = (value: string): void => {
    if (value.length >= MIN_STEM_LENGTH && value !== token) {
      stems.add(value);
    }
  };

  for (const prefix of PREFIXES) {
    if (token.startsWith(prefix)) {
      addIfLongEnough(token.slice(prefix.length));
    }
  }

  for (const suffix of SUFFIXES) {
    if (token.endsWith(suffix)) {
      addIfLongEnough(token.slice(0, token.length - suffix.length));
    }
  }

  for (const prefix of PREFIXES) {
    if (!token.startsWith(prefix)) {
      continue;
    }
    const withoutPrefix = token.slice(prefix.length);
    for (const suffix of SUFFIXES) {
      if (withoutPrefix.endsWith(suffix)) {
        addIfLongEnough(
          withoutPrefix.slice(0, withoutPrefix.length - suffix.length),
        );
      }
    }
  }

  return [...stems];
}

/**
 * Arabic-specific pipeline. Extra stages (dialect lists, better Arabizi)
 * should be added here rather than in the matcher.
 */
export class ArabicNormalizer implements TextNormalizer {
  readonly language = "ar";

  normalize(text: string): string {
    const unicode = applyUnicode(text);
    const folded = foldArabicLetters(unicode);
    const lower = folded.toLowerCase();
    return collapseSpaces(punctuationToSpace(lower));
  }

  tokenize(normalizedText: string): string[] {
    return tokenizeNormalized(normalizedText);
  }

  tokenVariants(token: string): string[] {
    const variants = new Set<string>([token]);
    for (const arabizi of convertArabizi(token)) {
      variants.add(arabizi);
    }
    for (const base of [...variants]) {
      for (const stem of stripAffixes(base)) {
        variants.add(stem);
      }
    }
    return [...variants];
  }
}

export const arabicNormalizer = new ArabicNormalizer();
