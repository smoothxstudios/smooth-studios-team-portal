CREATE TABLE image_previews (image_id TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL, bytes BLOB NOT NULL, created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE project_image_refs (project_id TEXT NOT NULL, image_id TEXT NOT NULL, PRIMARY KEY(project_id,image_id));
--> statement-breakpoint
CREATE INDEX project_image_refs_image ON project_image_refs(image_id,project_id);
--> statement-breakpoint
INSERT OR IGNORE INTO project_image_refs(project_id,image_id)
SELECT p.id,json_extract(r.value,'$.id') FROM projects p,json_each(p.data,'$.shots') s,json_each(s.value,'$.references') r
WHERE json_extract(r.value,'$.id') IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER project_image_refs_insert AFTER INSERT ON projects BEGIN
 INSERT OR IGNORE INTO project_image_refs(project_id,image_id)
 SELECT NEW.id,json_extract(r.value,'$.id') FROM json_each(NEW.data,'$.shots') s,json_each(s.value,'$.references') r WHERE json_extract(r.value,'$.id') IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER project_image_refs_update AFTER UPDATE OF data ON projects BEGIN
 DELETE FROM project_image_refs WHERE project_id=NEW.id;
 INSERT OR IGNORE INTO project_image_refs(project_id,image_id)
 SELECT NEW.id,json_extract(r.value,'$.id') FROM json_each(NEW.data,'$.shots') s,json_each(s.value,'$.references') r WHERE json_extract(r.value,'$.id') IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER project_image_refs_delete AFTER DELETE ON projects BEGIN
 DELETE FROM project_image_refs WHERE project_id=OLD.id;
END;
