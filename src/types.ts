export interface DictionaryEntry {
  term: string;
  concept?: string;
  extra?: Record<string, unknown>;
}

export interface IndexedTerm {
  term: string;
  concept?: string;
  sourceFile: string;
  language: string;
}

export interface DictionaryLoadIssue {
  fileName: string;
  message: string;
}

export interface AnalyzeIssue {
  code: string;
  message: string;
}

export interface AnalyzeMatch {
  term: string;
  concept?: string;
  sourceFile: string;
  normalizedTerm: string;
  tokenStart: number;
  tokenEnd: number;
}

export interface AnalyzeTextResult {
  text: string;
  content: string;
  language: string;
  matched: boolean;
  terms: string[];
  matches: AnalyzeMatch[];
  usedSources: string[];
  issues: AnalyzeIssue[];
}

export interface AnalyzeTextOptions {
  /**
   * Override dictionary location. Defaults to DICTIONARIES_DIR or <cwd>/dictionaries.
   * Useful when this module is later mounted inside a larger application.
   */
  dictionariesDir?: string;

  /**
   * Filter matches by concept prefix (e.g. ['violence', 'intent.threat']).
   * If provided, only matches with matching concepts are returned.
   */
  concepts?: string[];

  /**
   * Cap on the number of matches to return per text.
   */
  maxMatches?: number;
}
