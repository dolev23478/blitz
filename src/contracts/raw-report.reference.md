# RAW_REPORT reference reconciliation

Source: the `RAW_REPORT` section of the user-supplied `schemas-new-2.html`,
reviewed on 2026-10-20. Other entities and their processing policies are outside
this comparison. This is a field-table reference, not an executable JSON Schema.

| Field in the supplied table | Table type / notes | Transformer wire representation |
| --- | --- | --- |
| `report_id` | int64; unique, non-null; collector-generated; message key | Nonnegative integer `0..2147483647`, per the user's explicit int32 requirement |
| `schema_version` | int; contract major version | Integer `1`, per the user's approved major version |
| `is_official` | boolean | `false` for Blitz |
| `platform` | string; free text | string |
| `account_name` | string | string or null when unavailable; nullability remains a local assumption |
| `channel_name` | string | string or null when unavailable; nullability remains a local assumption |
| `report_url` | string; unchanged; unique with platform | Original collector URL |
| `media_type` | string[]; text, photo, video | Array restricted to `text`, `photo`, `video` |
| `media_urls` | string[]; optional | Public S3 URLs of uploaded photos (X and Telegram); omitted when none. Local extension, needs DE sign-off |
| `report_title` | string; null if none | string or null |
| `content` | string; required, never empty; parsed text, not HTML | Nonblank parsed text |
| `language` | string; ISO 639-1; collector-supplied | **`languages: string[]`**, per the user's explicit newer requirement; legacy collector `language` is accepted before normalization |
| `matches` | string[]; collector trigger keywords | string[] |
| `categories` | string[]; collector-supplied; allowed values not defined yet | string[]; no invented category enum |
| `published_at` | datetime; UTC, nullable | UTC ISO 8601 string or null |
| `collected_at` | datetime; UTC | UTC ISO 8601 string; Telegram uses receipt time as previously approved |

The language name/type and the accepted ID range deliberately follow the user's
explicit requirements rather than silently reverting to the attached table.
The table does not establish missing-language behavior; the user selected `[]`.
The int32 hash fallback does not guarantee the table's global ID uniqueness across
Blitz and Atlas. Upstream deduplication remains outside this component.

The table does not specify all required fields, array cardinalities, category
values, additional-property handling or account/channel nullability. Local
validation remains provisional on those details. The executable DE JSON Schema
is still needed to verify complete compatibility; this HTML cannot be used as
`DE_RAW_REPORT_SCHEMA_PATH`.

The table's mention of `reports.dlq` does not grant this publisher ownership of
DE's failure pipeline. Invalid input is rejected before publication. Publication
exhaustion follows the user's separately approved policy: initial attempt plus
three retries, then permanent removal from the Redis queue.
