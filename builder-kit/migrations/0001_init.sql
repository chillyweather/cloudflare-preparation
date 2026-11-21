-- Migration number: 0001 	 2026-11-21T13:56:02.517Z
CREATE TABLE apps (
  id         TEXT PRIMARY KEY,
  owner      TEXT NOT NULL,
  name       TEXT NOT NULL,
  url        TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_apps_owner ON apps(owner);
