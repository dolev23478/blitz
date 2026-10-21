export {
  analyzeText,
  analyzeBatch,
  createTextAnalyzer,
  detectLanguages,
  evaluateThreat,
  TextAnalyzer,
} from "./text-analyzer.js";
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
export { hebrewNormalizer } from "./normalize/hebrew-normalizer.js";
export { emojiNormalizer } from "./normalize/emoji-normalizer.js";
export { padEmojis } from "./normalize/shared.js";
export { parseDictionaryFile } from "./dictionaries/schema.js";
export {
  REPORT_CATEGORIES,
  ReportCategory,
  ReportCategoryLabel,
  ThreatCategory,
  ThreatMode,
} from "./types.js";
export type {
  AnalyzeIssue,
  AnalyzeMatch,
  AnalyzeTextOptions,
  AnalyzeTextResult,
  CanonicalThreatCategory,
  DictionaryEntry,
  DictionaryLoadIssue,
  IndexedTerm,
  ReportCategoryLabelValue,
  ReportCategoryValue,
  RiskLevel,
  ThreatEvaluation,
  ThreatEvaluationMode,
} from "./types.js";
