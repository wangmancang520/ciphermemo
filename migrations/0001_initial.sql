CREATE TABLE IF NOT EXISTS vault (
  id TEXT PRIMARY KEY CHECK (id = 'personal'), username TEXT NOT NULL UNIQUE,
  auth_hash TEXT NOT NULL, kdf TEXT NOT NULL, wrapped_key TEXT NOT NULL,
  recovery_hash TEXT NOT NULL, recovery_wrapped_key TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
  trusted INTEGER NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, vault_revision INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_token ON sessions(token_hash);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY, payload TEXT NOT NULL, bytes INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS notes_updated ON notes(updated_at);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY, note_id TEXT NOT NULL, metadata TEXT NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0, chunks INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_note ON attachments(note_id);
CREATE TABLE IF NOT EXISTS chunks (
  attachment_id TEXT NOT NULL, part INTEGER NOT NULL, bytes INTEGER NOT NULL,
  PRIMARY KEY(attachment_id, part)
);
CREATE TABLE IF NOT EXISTS attempts (
  bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deletions (note_id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS maintenance (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY CHECK (id = 'personal'), payload TEXT NOT NULL,
  avatar_id TEXT, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
