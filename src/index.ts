export { analyzeText, createTextAnalyzer, TextAnalyzer } from "./text-analyzer.js";
export {
  DictionaryStore,
  getDictionaryStore,
  loadDictionaries,
  resetDictionaryStoreCache,
} from "./dictionaries/load-dictionaries.js";
export { registerNormalizer, getNormalizer } from "./normalize/registry.js";
export { arabicNormalizer } from "./normalize/arabic-normalizer.js";
export { farsiNormalizer } from "./normalize/farsi-normalizer.js";
export { englishNormalizer } from "./normalize/english-normalizer.js";
export { parseDictionaryFile } from "./dictionaries/schema.js";
export type {
  AnalyzeIssue,
  AnalyzeMatch,
  AnalyzeTextOptions,
  AnalyzeTextResult,
  DictionaryEntry,
  DictionaryLoadIssue,
  IndexedTerm,
} from "./types.js";
