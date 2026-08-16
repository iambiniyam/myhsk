ALTER TABLE analytics_events ADD COLUMN visitor_id TEXT;
CREATE INDEX IF NOT EXISTS analytics_events_visitor_time ON analytics_events(visitor_id, created_at);
