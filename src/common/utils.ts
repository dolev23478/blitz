export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
