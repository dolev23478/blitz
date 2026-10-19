import type { AnalyzeMatch, IndexedTerm } from "../types.js";
import type { TextNormalizer } from "../normalize/types.js";

export interface LanguageTermIndex {
  language: string;
  sourceFiles: string[];
  maxTokenCount: number;
  entryCount: number;
  byNormalizedTerm: Map<string, IndexedTerm[]>;
}

export interface TermMatcher {
  match(
    tokens: string[],
    index: LanguageTermIndex,
    normalizer: TextNormalizer,
  ): AnalyzeMatch[];
}

function matchKey(match: AnalyzeMatch): string {
  return [
    match.term,
    match.concept ?? "",
    match.sourceFile,
    String(match.tokenStart),
    String(match.tokenEnd),
  ].join("\u0000");
}

/**
 * Sliding-window lookup against a prebuilt term map. Replace this class when
 * a richer matcher (fuzzy, morphological) is needed.
 */
export class DictionaryTermMatcher implements TermMatcher {
  match(
    tokens: string[],
    index: LanguageTermIndex,
    normalizer: TextNormalizer,
  ): AnalyzeMatch[] {
    const found: AnalyzeMatch[] = [];
    const seen = new Set<string>();

    for (let start = 0; start < tokens.length; start += 1) {
      const maxLength = Math.min(index.maxTokenCount, tokens.length - start);

      for (let length = 1; length <= maxLength; length += 1) {
        const end = start + length;
        const span = tokens.slice(start, end);
        const first = span[0];
        if (first === undefined) {
          continue;
        }

        const candidates =
          length === 1
            ? normalizer.tokenVariants(first)
            : [span.join(" ")];

        for (const candidate of candidates) {
          const entries = index.byNormalizedTerm.get(candidate);
          if (!entries) {
            continue;
          }
          for (const entry of entries) {
            const match: AnalyzeMatch = {
              term: entry.term,
              ...(entry.concept !== undefined ? { concept: entry.concept } : {}),
              sourceFile: entry.sourceFile,
              normalizedTerm: candidate,
              tokenStart: start,
              tokenEnd: end,
            };
            const key = matchKey(match);
            if (seen.has(key)) {
              continue;
            }
            seen.add(key);
            found.push(match);
          }
        }
      }
    }

    return found;
  }
}

export const defaultTermMatcher = new DictionaryTermMatcher();
