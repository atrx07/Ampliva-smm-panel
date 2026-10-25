CREATE TABLE IF NOT EXISTS lookup_cache (
  username TEXT PRIMARY KEY,
  profile TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
