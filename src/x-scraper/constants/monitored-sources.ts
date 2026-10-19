export interface MonitoredSource {
  name: string;
  handle: string;
  category: 'Major Regional & International Networks' | 'Local, Field, Campaign & Operational Channels';
  lang: string;
}

/**
 * Filtered list from OSINT Source Monitoring:
 * All sources verified with an active X (Twitter) presence.
 */
export const MONITORED_X_SOURCES: MonitoredSource[] = [
  // 1. Major Regional & International Networks
  { name: 'Al Jazeera Channel', handle: 'AJArabic', category: 'Major Regional & International Networks', lang: 'Arabic' },
  { name: 'Al Jazeera English', handle: 'AJEnglish', category: 'Major Regional & International Networks', lang: 'English' },
  { name: 'Al Arabiya', handle: 'AlArabiya', category: 'Major Regional & International Networks', lang: 'Arabic' },
  { name: 'Sky News Arabia', handle: 'skynewsarabia', category: 'Major Regional & International Networks', lang: 'Arabic' },
  { name: 'BBC Arabic / Persian', handle: 'BBCArabic', category: 'Major Regional & International Networks', lang: 'Ar/Fa' },
  { name: 'RT Arabic / RT Egypt', handle: 'RTarabic', category: 'Major Regional & International Networks', lang: 'Arabic' },
  { name: 'Al Mayadeen News', handle: 'AlMayadeenNews', category: 'Major Regional & International Networks', lang: 'Arabic' },
  { name: 'Tasnim News Agency', handle: 'Tasnimnews_Fa', category: 'Major Regional & International Networks', lang: 'Persian' },
  { name: 'Fars News Agency', handle: 'FarsNews_Agency', category: 'Major Regional & International Networks', lang: 'Persian' },
  { name: 'Press TV', handle: 'PressTV', category: 'Major Regional & International Networks', lang: 'English' },
  { name: 'Iran International', handle: 'IranIntl', category: 'Major Regional & International Networks', lang: 'Persian' },
  { name: 'TRT World', handle: 'trtworld', category: 'Major Regional & International Networks', lang: 'English' },

  // 2. Local, Field, Campaign & Operational Channels
  { name: 'Quds News Network', handle: 'QudsN', category: 'Local, Field, Campaign & Operational Channels', lang: 'Arabic' },
  { name: 'Shehab Agency', handle: 'ShehabAgency', category: 'Local, Field, Campaign & Operational Channels', lang: 'Arabic' },
  { name: 'Al-Qastal', handle: 'AlQastalps', category: 'Local, Field, Campaign & Operational Channels', lang: 'Arabic' },
  { name: 'Palestine Info Center', handle: 'PalinfoAr', category: 'Local, Field, Campaign & Operational Channels', lang: 'Arabic' },
];
