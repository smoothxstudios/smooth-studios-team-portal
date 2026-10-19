CREATE TABLE dashboard_sync_requests (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  requested_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL DEFAULT 'waiting'
);
INSERT INTO dashboard_sync_requests(id) VALUES (1);
