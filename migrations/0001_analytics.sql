CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  session_id TEXT NOT NULL,
  event TEXT NOT NULL,
  area TEXT,
  detail TEXT,
  value INTEGER,
  country TEXT
);

CREATE INDEX IF NOT EXISTS analytics_events_created_at ON analytics_events(created_at);
CREATE INDEX IF NOT EXISTS analytics_events_event_created_at ON analytics_events(event, created_at);
CREATE INDEX IF NOT EXISTS analytics_events_session_created_at ON analytics_events(session_id, created_at);
