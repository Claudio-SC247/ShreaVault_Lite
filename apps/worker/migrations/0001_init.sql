CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  downloaded_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_shares_token ON shares (token);
CREATE INDEX IF NOT EXISTS idx_shares_created_at ON shares (created_at);

