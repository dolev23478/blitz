-- Account-collected media is served on demand from /api/media/<channel_id>/<message_id>.
UPDATE messages m
SET media = (
  SELECT jsonb_agg(jsonb_set(e, '{url}', to_jsonb('/api/media/' || m.channel_id || '/' || m.message_id)))
  FROM jsonb_array_elements(m.media) e
)
FROM channels c
WHERE c.id = m.channel_id AND c.source = 'mtproto' AND jsonb_array_length(m.media) > 0;
