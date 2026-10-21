import type { TextNormalizer } from "./types.js";
import {
  applyUnicode,
  collapseSpaces,
  getRepeatedCharVariants,
  punctuationToSpace,
  tokenizeNormalized,
} from "./shared.js";

/** Hebrew vowel points (Niqqud) and cantillation marks (Te'amim). */
const HEBREW_NIQQUD = /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g;
const COMBINING_MARKS = /\p{M}+/gu;

/** Final (sofit) vs medial letter mappings */
const MEDIAL_TO_SOFIT: Record<string, string> = {
  כ: "ך",
  מ: "ם",
  נ: "ן",
  פ: "ף",
  צ: "ץ",
};

/**
 * Standard Hebrew clitics (proclitics) attached without spaces.
 * Longest first to match greedy prefixes.
 */
const PREFIXES = [
  "ומה",
  "וכש",
  "ושה",
  "ושב",
  "ושל",
  "ושמ",
  "וה",
  "וב",
  "ול",
  "ומ",
  "וכ",
  "וש",
  "שה",
  "שב",
  "של",
  "שמ",
  "כש",
  "מה",
  "בה",
  "לה",
  "ה",
  "ו",
  "ב",
  "ל",
  "מ",
  "כ",
  "ש",
];

/**
 * Common Hebrew inflectional and possessive suffixes.
 * Longest first.
 */
const SUFFIXES = [
  "ותיהם",
  "ותיהן",
  "ותינו",
  "ותיכם",
  "ותיכן",
  "יהם",
  "יהן",
  "יכם",
  "יכן",
  "ינו",
  "ות",
  "ים",
  "יים",
  "יה",
  "יו",
  "יך",
  "ית",
  "הם",
  "הן",
  "כם",
  "כן",
  "נו",
  "ה",
  "ו",
  "י",
  "ת",
  "ך",
];

/** Minimum stem length when both a prefix and a suffix were stripped (e.g. שירים must not reach ירי). */
const MIN_STEM_BOTH_AFFIXES = 4;

/**
 * Everyday words that only look like prefix + dictionary term (בירה = ב + ירה, שאלה = ש + אלה).
 * They are matched as-is and never affix-stripped.
 */
const NO_AFFIX_STRIP = new Set<string>([
  "בירה", "הבירה", "בבירה", "לבירה", "בירות", "שבירה", "השבירה",
  "שירה", "השירה", "שמירה", "השמירה", "מהירה", "שאלה", "השאלה", "שאלות", "שואלים", "שואלת",
  "שמות", "השמות", "כמות", "הכמות", "שלמות",
  "בקרב", "לקרב", "מטבח", "המטבח", "במטבח",
  "הרוסים", "הרוסי", "הרוסית", "הדקות", "בדקות",
  "הליכה", "לטייל", "בעיירה", "אשפה", "האשפה", "בהשוואה",
  "שמיכה", "משיכה", "מוחות", "שרצית", "שרצה", "היכונו",
  "איימי", "אוונס", "בארני", "ארני", "סיירוס",
  "להטיל", "בתולה", "הפרעות", "מפגר", "מחורבן", "מחורבנת",
]);

function applySofit(str: string): string {
  if (str.length === 0) return str;
  const last = str[str.length - 1];
  if (last !== undefined && MEDIAL_TO_SOFIT[last]) {
    return str.slice(0, -1) + MEDIAL_TO_SOFIT[last];
  }
  return str;
}

function stripHebrewAffixes(token: string): string[] {
  const stems = new Set<string>();
  const minStem = 3;

  const addStem = (val: string): void => {
    if (val.length >= minStem && val !== token) {
      stems.add(val);
      const sofit = applySofit(val);
      if (sofit !== val) {
        stems.add(sofit);
      }
    }
  };

  for (const suffix of SUFFIXES) {
    const minLen = suffix.length === 1 ? 3 : 2;
    if (token.endsWith(suffix) && token.length - suffix.length >= minLen) {
      const stem = token.slice(0, token.length - suffix.length);
      addStem(stem);
      if (suffix === "ות") {
        addStem(stem + "ה");
        addStem(stem + "ית");
      }
      if (suffix === "ת" && stem.length >= 3) {
        addStem(stem + "ה");
      }
      if (suffix === "ית") {
        addStem(stem + "י");
      }
    }
  }

  for (const prefix of PREFIXES) {
    if (token.startsWith(prefix) && token.length - prefix.length >= minStem) {
      const withoutPrefix = token.slice(prefix.length);
      addStem(withoutPrefix);
      for (const suffix of SUFFIXES) {
        if (
          withoutPrefix.endsWith(suffix) &&
          withoutPrefix.length - suffix.length >= MIN_STEM_BOTH_AFFIXES
        ) {
          const stemBoth = withoutPrefix.slice(
            0,
            withoutPrefix.length - suffix.length,
          );
          addStem(stemBoth);
          if (suffix === "ות") {
            addStem(stemBoth + "ה");
            addStem(stemBoth + "ית");
          }
          if (suffix === "ת") {
            addStem(stemBoth + "ה");
          }
        }
      }
    }
  }

  return [...stems];
}

export function cleanHebrewText(text: string): string {
  return text
    .replace(HEBREW_NIQQUD, "")
    .replace(COMBINING_MARKS, "")
    .replace(/׳/g, "'")
    .replace(/״/g, '"')
    // Strip quotes/gershayim inside acronyms (e.g. צה"ל -> צהל, אמל"ח -> אמלח)
    .replace(/(\p{L})["'](\p{L})/gu, "$1$2")
    // Strip dots between Hebrew letters (e.g. ק.ל.א.ש -> קלאש, נ..ר..צ..ח -> נרצח)
    .replace(/(?<=[\u0590-\u05FF])\.+(?=[\u0590-\u05FF])/gu, "");
}

/**
 * Hebrew text normalizer pipeline.
 * Handles Niqqud/diacritics removal, acronym flattening,
 * final letter (sofit) alternation, and clitic/affix stripping.
 */
export class HebrewNormalizer implements TextNormalizer {
  readonly language = "he";

  normalize(text: string): string {
    const unicode = applyUnicode(text);
    const cleaned = cleanHebrewText(unicode);
    const lower = cleaned.toLowerCase();
    return collapseSpaces(punctuationToSpace(lower));
  }

  tokenize(normalizedText: string): string[] {
    return tokenizeNormalized(normalizedText);
  }

  tokenVariants(token: string): string[] {
    // Expand 3+ repeated characters safely (e.g. פפפצצה -> פצצה)
    const baseTokens = getRepeatedCharVariants(token);
    const variants = new Set<string>(baseTokens);

    for (const base of baseTokens) {
      // Sofit letter alternation on the token itself
      const sofit = applySofit(base);
      if (sofit !== base) {
        variants.add(sofit);
      }

      if (NO_AFFIX_STRIP.has(base)) {
        continue;
      }

      // Affix stripping
      for (const stem of stripHebrewAffixes(base)) {
        variants.add(stem);
      }

      // Ktiv Male / Haser variants (collapsing double Vav/Yud e.g. חייל -> חיל)
      if (base.includes("יי")) {
        variants.add(base.replace(/יי/g, "י"));
      }
      if (base.includes("וו")) {
        variants.add(base.replace(/וו/g, "ו"));
      }
    }

    return [...variants];
  }
}

export const hebrewNormalizer = new HebrewNormalizer();
