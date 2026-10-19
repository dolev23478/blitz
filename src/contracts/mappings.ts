/** Each name selects the mapper for that existing collector interface. */
export type MappingFormat =
  'ProfileScrapeResult' | 'StoredMessage' | 'MessageDto';

/** Only fields missing from collector JSON; passed separately from the payload. */
export interface ReportMetadata {
  language: string;
  matches?: string[];
  reportUrl?: string;
  collectedAt?: string;
}
