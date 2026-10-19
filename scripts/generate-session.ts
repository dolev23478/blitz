import 'dotenv/config';
import { createAuthClient } from '../src/tg-realtime/client.js';

/**
 * ONE-TIME, LOCAL ONLY (`npm run auth`). Logs in interactively (phone, code, 2FA),
 * then prints the session string to put in TG_SESSION_STRING. Never run this in production.
 * Treat the output like a password: anyone holding it controls your Telegram account.
 */
const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH?.trim();
if (!Number.isInteger(apiId) || !apiHash) {
  console.error('Set TG_API_ID and TG_API_HASH in .env first (https://my.telegram.org).');
  process.exit(1);
}

const tg = createAuthClient(apiId, apiHash);
const user = await tg.start({
  phone: () => tg.input('Phone number (international format, e.g. +972501234567): '),
  code: () => tg.input('Login code from Telegram: '),
  password: () => tg.input('2FA password: '),
});
const session = await tg.exportSession();
await tg.destroy();

console.log(`\nLogged in as ${user.displayName} (${user.id}).`);
console.log('\nCopy this line into your .env / GitHub secret:\n');
console.log(`TG_SESSION_STRING=${session}`);
console.log('\nKeep it secret. Revoke it in Telegram -> Settings -> Devices if it leaks.');
