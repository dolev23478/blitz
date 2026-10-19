/** Unicode compatibility form folds presentation forms and ligatures. */
export function applyUnicode(text: string): string {
  return text.normalize("NFKC");
}

export function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * Ensures emojis are separated by spaces even if typed consecutively without spaces (e.g. 🔪💣🩸 -> 🔪 💣 🩸).
 */
export function padEmojis(text: string): string {
  if (!/\p{Extended_Pictographic}/u.test(text)) {
    return text;
  }
  let result = "";
  for (const { segment } of graphemeSegmenter.segment(text)) {
    if (/\p{Extended_Pictographic}/u.test(segment)) {
      result += ` ${segment} `;
    } else {
      result += segment;
    }
  }
  return result;
}

/**
 * Keep letters, numbers, apostrophes, and emojis. Everything else becomes a space so
 * matching is token-based rather than raw substring search.
 */
export function punctuationToSpace(text: string): string {
  const padded = padEmojis(text);
  return padded.replace(/[^\p{L}\p{N}\p{Extended_Pictographic}']+/gu, " ");
}

export function tokenizeNormalized(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  return text.split(" ").filter((token) => token.length > 0);
}
