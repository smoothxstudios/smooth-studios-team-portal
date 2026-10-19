CREATE TABLE owner_event_planner (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
 data TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
INSERT INTO owner_event_planner(id, revision, data, updated_at)
VALUES(1,0,'{"events":[],"guests":[],"availability":[]}',0);
