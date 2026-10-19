export interface TextNormalizer {
  readonly language: string;
  normalize(text: string): string;
  tokenize(normalizedText: string): string[];
  /**
   * Extra lookup keys for a single token (clitics, script variants, etc.).
   * The original token is always included by the matcher.
   */
  tokenVariants(token: string): string[];
}
