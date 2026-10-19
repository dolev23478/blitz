const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{3,31}$/;

export class NumericChannelIdError extends Error {
  constructor() {
    super(
      'Numeric Telegram IDs (e.g. web.telegram.org/a/#-100…) cannot be resolved without an account. ' +
        'Open the channel, copy its public @username or t.me/<name> link instead.',
    );
  }
}

/**
 * Accepts "name", "@name", "t.me/name", "https://t.me/s/name" and Telegram Web links like
 * "https://web.telegram.org/a/#@name"; returns the lowercase username or null if invalid.
 */
export function normalizeUsername(input: string): string | null {
  const raw = input.trim();
  const web = raw.match(/^(?:https?:\/\/)?web\.telegram\.org\/[^#]*#(.*)$/);
  if (web && /^-?\d+$/.test(web[1]!)) throw new NumericChannelIdError();
  const name = (web ? web[1]! : raw)
    .replace(/^https?:\/\//, '')
    .replace(/^(www\.)?(t\.me|telegram\.me)\/(s\/)?/, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0]!;
  return USERNAME_RE.test(name) ? name.toLowerCase() : null;
}
