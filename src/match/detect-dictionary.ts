import { getDictionaryStore } from '../dictionaries/load-dictionaries.js';
import { UNKNOWN_LANGUAGE } from '../common/constants.js';
import { analyzeText } from '../text-analyzer.js';

export interface DictionaryDetection {
  /** ISO 639-1 code of the matching language dictionary, or `unknown` for matches from non-language dictionaries (e.g. emoji). */
  language: string;
  terms: string[];
}

/** Returns the first dictionary match for the text, preferring real language dictionaries over e.g. the emoji one. */
export function detectDictionaryMatch(text: string): DictionaryDetection | null {
  const all = getDictionaryStore().languages();
  const real = all.filter((l) => /^[a-z]{2}$/.test(l));
  const other = all.filter((l) => !/^[a-z]{2}$/.test(l));

  for (const language of real) {
    const analysis = analyzeText(text, language);
    if (analysis.matched) return { language, terms: analysis.terms };
  }
  for (const language of other) {
    const analysis = analyzeText(text, language);
    if (analysis.matched) return { language: UNKNOWN_LANGUAGE, terms: analysis.terms };
  }
  return null;
}
