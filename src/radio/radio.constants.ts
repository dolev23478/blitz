import type { RadioStation } from './radio.config.js';

/** Audio recorded per station (1–300 seconds). Rebuild/restart after editing. */
export const RECORDING_SECONDS = 30;

/** Pause AFTER the whole cycle finishes, including transcription (0–86400 seconds). */
export const PAUSE_SECONDS = 60;

/** Public radio streams and TV feeds captured as audio only. Add/remove sources here. */
export const RADIO_STATIONS: RadioStation[] = [
  {
    id: 'radio-al-balad',
    name: 'Radio Al-Balad 92.5 — Amman',
    // HTTPS relay from the official player at https://ammannet.net/live
    streamUrl: 'https://s3.voscast.com/cdn/?k=6ad86d4e0f0e1&m=',
    language: 'ar',
  },
  {
    id: 'radio-nisaa',
    name: 'Radio Nisaa FM — Ramallah',
    streamUrl: 'https://rstream.hadara.ps/proxy/nisaa/stream',
    language: 'ar',
  },
  {
    id: 'radio-hayat',
    name: 'Radio Hayat FM — Nablus',
    streamUrl: 'https://rstream.hadara.ps/proxy/hayat/stream.mp3',
    language: 'ar',
  },
  {
    id: 'radio-husna',
    name: 'Husna FM — Amman, Jordan',
    streamUrl: 'http://s10.voscast.com:10440/stream',
    language: 'ar',
  },
  {
    id: 'voice-of-lebanon',
    name: 'Voice of Lebanon 100.5 — Beirut, Lebanon',
    streamUrl: 'https://l3.itworkscdn.net/itwaudio/9054/stream',
    language: 'ar',
  },
  {
    id: 'mosaique-fm',
    name: 'Mosaique FM — Tunis, Tunisia',
    streamUrl: 'https://radio.mosaiquefm.net/mosalive',
    language: 'ar',
  },
  {
    id: 'radio-al-nour',
    name: 'Radio Al-Nour — Lebanon',
    // Direct audio source published at https://www.alnour.com.lb/live
    streamUrl: 'https://l3.itworkscdn.net/itwaudio/9066/stream',
    language: 'ar',
  },
  {
    id: 'al-aqsa-tv-audio',
    name: 'Al-Aqsa TV — audio only, Arabic',
    // Public HLS relay; this is TV audio, not Al-Aqsa Voice Radio.
    streamUrl:
      'https://43869de4e1a0d641.servers.dvcloud.tv/hls/al_aqsa_channel/6udfi7v8a3eof6nlps6e9ovfrs65c7l7.m3u8',
    language: 'ar',
  },
  {
    id: 'al-masirah-tv-audio',
    name: 'Al-Masirah TV — audio only, Yemen',
    // Public HLS relay; the worker decodes only audio, in memory.
    streamUrl:
      'https://live.cdnbridge.tv/Almasirah/Almasirah_all/Almasirah/Almasirah_360p/chunks.m3u8',
    language: 'ar',
  },
];
