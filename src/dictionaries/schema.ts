import type { DictionaryEntry } from "../types.js";

export interface ParsedDictionaryFile {
  language: string;
  entries: DictionaryEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extraFields(
  entry: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key === "term" || key === "concept") {
      continue;
    }
    extra[key] = value;
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
}

/**
 * Validates the current dictionary JSON shape while keeping unknown entry
 * fields. When the schema grows, extend this function rather than the matcher.
 */
export function parseDictionaryFile(
  value: unknown,
  fileName: string,
): ParsedDictionaryFile {
  if (!isRecord(value)) {
    throw new Error(`${fileName}: dictionary root must be a JSON object`);
  }

  if (typeof value.language !== "string" || value.language.trim() === "") {
    throw new Error(`${fileName}: "language" must be a non-empty string`);
  }

  if (!Array.isArray(value.entries)) {
    throw new Error(`${fileName}: "entries" must be an array`);
  }

  const entries: DictionaryEntry[] = [];

  for (let i = 0; i < value.entries.length; i += 1) {
    const raw = value.entries[i];
    if (!isRecord(raw)) {
      throw new Error(`${fileName}: entries[${i}] must be an object`);
    }
    if (typeof raw.term !== "string" || raw.term.trim() === "") {
      throw new Error(
        `${fileName}: entries[${i}].term must be a non-empty string`,
      );
    }
    if (raw.concept !== undefined && typeof raw.concept !== "string") {
      throw new Error(
        `${fileName}: entries[${i}].concept must be a string when present`,
      );
    }

    const extra = extraFields(raw);
    entries.push({
      term: raw.term,
      ...(typeof raw.concept === "string" ? { concept: raw.concept } : {}),
      ...(extra ? { extra } : {}),
    });
  }

  return {
    language: value.language.trim().toLowerCase(),
    entries,
  };
}
