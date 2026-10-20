/** Each name selects the mapper for that existing collector interface. */
export type MappingFormat =
  'ProfileScrapeResult' | 'ParsedMessage' | 'RadioTranscript';

/** Only fields missing from collector JSON; passed separately from the payload. */
export interface ReportMetadata {
  languages?: string[] | null;
  /** Legacy caller metadata. */
  language?: string | string[] | null;
  categories?: string[] | null;
  matches?: string[];
  /** Optional source names missing from ParsedMessage. */
  accountName?: string | null;
  channelName?: string | null;
  /** Telegram receipt time, captured by the workflow before processing. */
  collectedAt?: string;
  source?: 'x' | 'telegram' | 'radio';
}
