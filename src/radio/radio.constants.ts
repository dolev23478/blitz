import type { RadioStation } from './radio.config.js';

/** Audio recorded per station (1–300 seconds). Rebuild/restart after editing. */
export const RECORDING_SECONDS = 30;

/** Pause AFTER the whole cycle finishes, including transcription (0–86400 seconds). */
export const PAUSE_SECONDS = 60;

/** Trusted direct public HTTP(S) audio streams. Add/remove stations here. */
export const RADIO_STATIONS: RadioStation[] = [
  {
    id: 'radio-al-balad',
    name: 'Radio Al-Balad 92.5 — Amman',
    streamUrl: 'http://s3.voscast.com:8964/;stream.mp3',
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
    id: 'iran-international',
    name: 'Iran International — Persian news',
    streamUrl: 'https://stream.radiojar.com/dfnrphnr5f0uv',
    language: 'fa',
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
];
