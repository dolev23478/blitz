import { describe, expect, it } from 'vitest';
import { createClient, MISSING_SESSION_MESSAGE } from '../../src/tg-realtime/client.js';
import { loadConfig } from '../../src/tg-realtime/config.js';

describe('headless session', () => {
  it('createClient throws the clear message without a session string', () => {
    expect(() => createClient({ apiId: 1, apiHash: 'x' })).toThrow(MISSING_SESSION_MESSAGE);
    expect(MISSING_SESSION_MESSAGE).toBe(
      "Missing TG_SESSION_STRING in environment variables. Run 'npm run auth' locally to generate one.",
    );
  });

  it('loadConfig requires TG_SESSION_STRING', () => {
    const env = { TG_API_ID: '1', TG_API_HASH: 'h', TG_TARGETS: 'durov' };
    expect(() => loadConfig(env)).toThrow(MISSING_SESSION_MESSAGE);
    expect(loadConfig({ ...env, TG_SESSION_STRING: 'abc' }).sessionString).toBe('abc');
  });
});
