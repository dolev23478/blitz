/** Optional report metadata on existing collector objects, not an input envelope. */
export interface CollectorReportFields {
  report_id?: number;
  languages?: string[] | null;
  /** Legacy collector spelling; normalized into languages. */
  language?: string | string[] | null;
  categories?: string[] | null;
}
