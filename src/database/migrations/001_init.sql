CREATE TABLE IF NOT EXISTS channels (
  id              SERIAL PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE,
  title           TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  last_message_id INTEGER,
  backfilled_at   TIMESTAMPTZ,
  last_polled_at  TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id             BIGSERIAL PRIMARY KEY,
  channel_id     INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  message_id     INTEGER NOT NULL,
  posted_at      TIMESTAMPTZ NOT NULL,
  text           TEXT,
  views          INTEGER,
  media          JSONB NOT NULL DEFAULT '[]',
  links          JSONB NOT NULL DEFAULT '[]',
  forwarded_from TEXT,
  edited         BOOLEAN NOT NULL DEFAULT FALSE,
  url            TEXT NOT NULL,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, message_id)
);

CREATE INDEX IF NOT EXISTS messages_posted_at_idx ON messages (posted_at DESC);
CREATE INDEX IF NOT EXISTS messages_text_fts_idx ON messages USING GIN (to_tsvector('simple', coalesce(text, '')));
