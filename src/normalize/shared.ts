/** Unicode compatibility form folds presentation forms and ligatures. */
export function applyUnicode(text: string): string {
  return text.normalize("NFKC");
}

export function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Keep letters, numbers and apostrophes. Everything else becomes a space so
 * matching is token-based rather than raw substring search.
 */
export function punctuationToSpace(text: string): string {
  return text.replace(/[^\p{L}\p{N}']+/gu, " ");
}

export function tokenizeNormalized(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  return text.split(" ").filter((token) => token.length > 0);
}
