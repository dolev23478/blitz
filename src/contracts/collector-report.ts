/** Optional report metadata on existing collector objects, not an input envelope. */
export interface CollectorReportFields {
  languages?: string[] | null;
  /** Legacy collector spelling; normalized into languages. */
  language?: string | string[] | null;
  categories?: string[] | null;
}
