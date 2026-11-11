import { DatabaseSync } from 'node:sqlite'
import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy'
import { schema } from './schema'

const CREATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  pid INTEGER,
  cwd TEXT NOT NULL,
  project_name TEXT NOT NULL,
  status TEXT NOT NULL,
  status_reason TEXT NOT NULL,
  confidence TEXT NOT NULL,
  current_tool TEXT,
  last_error TEXT,
  attention TEXT,
  started_at INTEGER NOT NULL,
  last_event_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  last_assistant_message TEXT,
  exit_kind TEXT,
  hook_driven INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_activity_idx ON sessions(last_activity_at);

CREATE TABLE IF NOT EXISTS session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  at INTEGER NOT NULL,
  summary TEXT NOT NULL,
  tool_name TEXT,
  severity TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS session_events_unique_idx
  ON session_events(session_id, event_id);
CREATE INDEX IF NOT EXISTS session_events_session_at_idx
  ON session_events(session_id, at);
CREATE INDEX IF NOT EXISTS session_events_at_idx ON session_events(at);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_sent_at_idx ON notifications(sent_at);

CREATE TABLE IF NOT EXISTS application_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
PRAGMA user_version = 1;
`

export class Database {
  readonly sqlite: DatabaseSync
  readonly orm: SqliteRemoteDatabase<typeof schema>

  constructor(path: string) {
    this.sqlite = new DatabaseSync(path)
    this.sqlite.exec('PRAGMA journal_mode = WAL;')
    this.sqlite.exec('PRAGMA synchronous = NORMAL;')
    this.sqlite.exec('PRAGMA busy_timeout = 5000;')
    this.sqlite.exec(CREATE_SCHEMA)

    this.orm = drizzle(
      async (sql, params, method) => {
        const statement = this.sqlite.prepare(sql)
        statement.setReturnArrays(true)
        if (method === 'run') {
          statement.run(...(params as never[]))
          return { rows: [] }
        }
        if (method === 'get') {
          const row = statement.get(...(params as never[])) as unknown[] | undefined
          return { rows: (row ?? []) as unknown[] }
        }
        const rows = statement.all(...(params as never[])) as unknown[]
        return { rows }
      },
      { schema },
    )
  }

  close(): void {
    try {
      this.sqlite.close()
    } catch {
      // already closed
    }
  }
}
