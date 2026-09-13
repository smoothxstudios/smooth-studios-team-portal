CREATE TABLE image_uploads (id TEXT PRIMARY KEY, owner TEXT NOT NULL, project_id TEXT, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, parts INTEGER NOT NULL, completed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
CREATE INDEX image_uploads_created ON image_uploads(created_at);
