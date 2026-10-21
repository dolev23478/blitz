/** Unicode compatibility form folds presentation forms and ligatures. */
function applyUnicode(text: string): string {
  return text.normalize("NFKC");
}

function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/**
 * Ensures emojis are separated by spaces even if typed consecutively without spaces (e.g. 🔪💣🩸 -> 🔪 💣 🩸).
 */
function padEmojis(text: string): string {
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
 * Keep letters, numbers, apostrophes, emojis, and intra-word hyphens. Everything else becomes a space so
 * matching is token-based rather than raw substring search.
 * Intra-word hyphens (e.g. 'a-bomb', 'ak-47', 'f-16', '14-88', 'אל-קאעידה') are preserved so that
 * 'a bomb' (article + noun) is never confused with 'a-bomb'.
 */
function punctuationToSpace(text: string): string {
  const padded = padEmojis(text);
  const normalizedHyphens = padded.replace(
    /(?<=[\p{L}\p{N}])[\u002D\u05BE\u2010-\u2015]+(?=[\p{L}\p{N}])/gu,
    "-",
  );
  return normalizedHyphens.replace(
    /[^\p{L}\p{N}\p{Extended_Pictographic}'-]+|(?<![\p{L}\p{N}])-|-+(?![\p{L}\p{N}])/gu,
    " ",
  );
}

function tokenizeNormalized(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  return text.split(" ").filter((token) => token.length > 0);
}

/**
 * Collapses 3 or more consecutive identical characters into 1 and 2 characters.
 * Guarantees that words with 2 repeated characters (e.g. 'killer', 'shoot', 'attack')
 * are NEVER modified, because the regex requires 3 or more repetitions.
 */
function getRepeatedCharVariants(token: string): string[] {
  if (!/(.)\1{2,}/u.test(token)) {
    return [token];
  }
  const v1 = token.replace(/(.)\1{2,}/gu, (m, c) => c);
  const v2 = token.replace(/(.)\1{2,}/gu, (m, c) => c + c);
  return [...new Set([token, v1, v2])];
}

export {
  applyUnicode,
  collapseSpaces,
  getRepeatedCharVariants,
  padEmojis,
  punctuationToSpace,
  tokenizeNormalized,
};
