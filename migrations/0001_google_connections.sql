CREATE TABLE IF NOT EXISTS google_connections (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  google_sub TEXT NOT NULL,
  sealed_token TEXT NOT NULL
);
