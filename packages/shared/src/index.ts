export type Severity = 'low' | 'medium' | 'high';
export type MatchCategory = 'weapon' | 'violence' | 'threat' | 'terrorism' | 'other';

export interface WarningMatch {
  term: string;
  normalized: string;
  start: number;
  end: number;
  category: MatchCategory;
}

export interface FilteredPost {
  id: string;
  source: 'telegram' | 'x' | 'unknown';
  channel: string;
  channelId?: string | number;
  text: string;
  createdAt: string;
  severity: Severity;
  matches: WarningMatch[];
}

export interface FilteredPostSseEvent {
  type: 'filtered-post';
  payload: FilteredPost;
}

export function buildDemoPost(overrides: Partial<FilteredPost> = {}): FilteredPost {
  const now = new Date().toISOString();

  return {
    id: overrides.id ?? crypto.randomUUID(),
    source: overrides.source ?? 'telegram',
    channel: overrides.channel ?? 'front-page-demo',
    channelId: overrides.channelId ?? 'demo-1',
    text:
      overrides.text ??
      'We need to prepare explosives and move to the rooftop before the convoy passes.',
    createdAt: overrides.createdAt ?? now,
    severity: overrides.severity ?? 'high',
    matches:
      overrides.matches ?? [
        {
          term: 'explosives',
          normalized: 'explosives',
          start: 18,
          end: 28,
          category: 'weapon',
        },
        {
          term: 'rooftop',
          normalized: 'rooftop',
          start: 39,
          end: 46,
          category: 'violence',
        },
      ],
  };
}
