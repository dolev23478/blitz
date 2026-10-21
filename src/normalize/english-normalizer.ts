import type { TextNormalizer } from "./types.js";
import {
  applyUnicode,
  collapseSpaces,
  getRepeatedCharVariants,
  punctuationToSpace,
  tokenizeNormalized,
} from "./shared.js";

function expandEnglishWord(t: string, v: Set<string>): void {
  // High-value domain roots
  if (t.startsWith("terror")) {
    v.add("terror");
    v.add("terrorist");
    v.add("terrorism");
  }
  if (t.startsWith("threat")) {
    v.add("threat");
    v.add("threaten");
  }
  if (t.startsWith("extremis")) {
    v.add("extremist");
    v.add("extremism");
  }

  // Plural & verb inflections
  if (t.endsWith("ies") && t.length > 4) {
    v.add(t.slice(0, -3) + "y"); // enemies -> enemy, communities -> community
  }
  if (t.endsWith("es") && t.length > 3) {
    v.add(t.slice(0, -1));
    // Only sibilant stems take "-es" (matches -> match), otherwise takes -> tak, gates -> gat
    if (/(s|x|z|ch|sh|o)es$/.test(t)) {
      v.add(t.slice(0, -2));
    }
  }
  if (t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us") && t.length > 2) {
    v.add(t.slice(0, -1)); // attacks -> attack, civilians -> civilian, weapons -> weapon
  }
  if (t.endsWith("ed") && t.length > 3) {
    const stem = t.slice(0, -2);
    v.add(stem);
    v.add(t.slice(0, -1));
    if (hasDoubledFinalConsonant(stem)) {
      v.add(stem.slice(0, -1)); // robbed -> rob
    }
  }
  if (t.endsWith("ing") && t.length > 4) {
    const stem = t.slice(0, -3);
    v.add(stem);
    if (stem.length >= 3) {
      v.add(stem + "e"); // striking -> strike, hating -> hate (but not lying -> lye)
    }
    if (hasDoubledFinalConsonant(stem)) {
      v.add(stem.slice(0, -1)); // stabbing -> stab
    }
  }
  if (t.endsWith("ers") && t.length > 4) {
    v.add(t.slice(0, -1)); // attackers -> attacker
    v.add(t.slice(0, -3)); // attackers -> attack
  }
  if (t.endsWith("er") && t.length > 3) {
    v.add(t.slice(0, -2)); // attacker -> attack, bomber -> bomb
  }
  if (t.endsWith("tion") && t.length > 5) {
    v.add(t.slice(0, -4) + "te"); // retaliation -> retaliate (bare stem would turn operation into opera)
  }
  if (t.endsWith("tions") && t.length > 6) {
    v.add(t.slice(0, -5) + "te");
  }
}

/** robbed -> robb -> rob, but fall/kill/pass/buzz keep their double letter (falling must not reach fal). */
function hasDoubledFinalConsonant(stem: string): boolean {
  const last = stem[stem.length - 1];
  return (
    stem.length > 3 &&
    last === stem[stem.length - 2] &&
    last !== undefined &&
    !"lsfz".includes(last)
  );
}

function getEnglishVariants(token: string): string[] {
  const t = token.toLowerCase();
  // Safe repeated character collapsing: only triggers on 3+ identical chars (e.g. shoooooot -> shoot)
  // Words with 2 identical chars (like 'killer', 'shoot', 'attack') are strictly untouched!
  const baseTokens = getRepeatedCharVariants(t);
  const v = new Set<string>(baseTokens);

  for (const base of baseTokens) {
    expandEnglishWord(base, v);
  }

  return [...v];
}

/**
 * English normalizer with inflection variants (plurals, verb tenses, agent nouns).
 */
export class EnglishNormalizer implements TextNormalizer {
  readonly language = "en";

  normalize(text: string): string {
    const unicode = applyUnicode(text);
    const lower = unicode.toLowerCase();
    return collapseSpaces(punctuationToSpace(lower));
  }

  tokenize(normalizedText: string): string[] {
    return tokenizeNormalized(normalizedText);
  }

  tokenVariants(token: string): string[] {
    return getEnglishVariants(token);
  }
}

export const englishNormalizer = new EnglishNormalizer();
