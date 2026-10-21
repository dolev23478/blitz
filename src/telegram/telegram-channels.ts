/** Monitored public Telegram channels (usernames), from osint_database_balanced_platforms_v2_0309.xlsx. */
export const TELEGRAM_CHANNELS: readonly string[] = [
  'aljazeera',
  'aljazeeramubasher',
  'almayadeen',
  'tasnimnews',
  'farsna',
  'presstv',
  'qudsn',
  'safaps',
  'gazaalannet',
  'jeninqassam',
  'kotlabzu',
  'Alaqsa_voice',
  'sabereenews',
  'MMY1444',
  'C_Military1',
  'almanarnews',
  'wolpalestine',
  'youthdemand',
  'NationalSJP',
  'blitz111222',
];

/** Redis key prefix of the per-channel resume point: telegram:cursor:<chatId> -> { channelId, channel, messageId, date }. */
export const TELEGRAM_CURSOR_PREFIX = 'telegram:cursor:';

/** Redis cache of resolved channels: telegram:peer:<username lowercase> -> { id }, so a restart does not call ResolveUsername again. */
export const TELEGRAM_PEER_PREFIX = 'telegram:peer:';
export const TELEGRAM_PEER_TTL_SECONDS = 30 * 24 * 60 * 60;
