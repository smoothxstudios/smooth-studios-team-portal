CREATE TABLE guideline_questions (
  id TEXT PRIMARY KEY NOT NULL,
  asked_by TEXT NOT NULL,
  question TEXT NOT NULL,
  normalized TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'answered', 'dismissed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX guideline_questions_status ON guideline_questions(status, created_at);
CREATE UNIQUE INDEX guideline_questions_author_text ON guideline_questions(asked_by, normalized);
