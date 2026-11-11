import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const sessionsTable = sqliteTable(
  'sessions',
  {
    sessionId: text('session_id').primaryKey(),
    pid: integer('pid'),
    cwd: text('cwd').notNull(),
    projectName: text('project_name').notNull(),
    status: text('status').notNull(),
    statusReason: text('status_reason').notNull(),
    confidence: text('confidence').notNull(),
    currentTool: text('current_tool'),
    lastError: text('last_error'),
    attention: text('attention'),
    startedAt: integer('started_at').notNull(),
    lastEventAt: integer('last_event_at').notNull(),
    lastActivityAt: integer('last_activity_at').notNull(),
    lastAssistantMessage: text('last_assistant_message'),
    exitKind: text('exit_kind'),
    hookDriven: integer('hook_driven', { mode: 'boolean' }).notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('sessions_activity_idx').on(table.lastActivityAt)],
)

export const sessionEventsTable = sqliteTable(
  'session_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    eventId: text('event_id').notNull(),
    sessionId: text('session_id').notNull(),
    name: text('name').notNull(),
    at: integer('at').notNull(),
    summary: text('summary').notNull(),
    toolName: text('tool_name'),
    severity: text('severity').notNull(),
  },
  (table) => [
    uniqueIndex('session_events_unique_idx').on(table.sessionId, table.eventId),
    index('session_events_session_at_idx').on(table.sessionId, table.at),
    index('session_events_at_idx').on(table.at),
  ],
)

export const notificationsTable = sqliteTable(
  'notifications',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: text('session_id').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    sentAt: integer('sent_at').notNull(),
  },
  (table) => [index('notifications_sent_at_idx').on(table.sentAt)],
)

export const appSettingsTable = sqliteTable('application_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const schema = {
  sessionsTable,
  sessionEventsTable,
  notificationsTable,
  appSettingsTable,
}
