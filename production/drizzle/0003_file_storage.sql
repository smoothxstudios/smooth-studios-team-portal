CREATE TABLE file_chunks (object_key TEXT NOT NULL, part INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(object_key,part));
