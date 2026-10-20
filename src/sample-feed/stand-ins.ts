/**
 * LOCAL STAND-INS for team components that are not in dev yet. Their results are labelled
 * `stand-in` in the output and must never be read as results of the real components.
 * Replace each one in context.ts once the team component is merged.
 */
import type { LanguageDetector } from './types.js';

/**
 * Stand-in for Leonid's language model (planned for 20.10): the script with the most letters wins.
 * Only he / ar / en; real mixed-language handling is Leonid's.
 */
export const standInDetectLanguage: LanguageDetector = (text) => {
  const count = (re: RegExp) => text.match(re)?.length ?? 0;
  const scores: [string, number][] = [
    ['he', count(/[֐-׿]/g)],
    ['ar', count(/[؀-ۿ]/g)],
    ['en', count(/[A-Za-z]/g)],
  ];
  return scores.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0];
};
