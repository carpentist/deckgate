import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import { normalizeSettings } from '@shared/schemas/settings'
import type { AppSettings } from '@shared/types/settings'
import type {
  Attention,
  Session,
  SessionEventView,
  SessionStatus,
} from '@shared/types/session'
import type { Database } from './database'
import {
  appSettingsTable,
  notificationsTable,
  sessionEventsTable,
  sessionsTable,
} from './schema'

const ACTIVE_STATUSES = new Set<string>([
  'RUNNING',
  'WAITING_PERMISSION',
  'WAITING_INPUT',
  'UNKNOWN',
])
const SESSION_STATUSES = new Set<string>([
  'RUNNING',
  'WAITING_PERMISSION',
  'WAITING_INPUT',
  'COMPLETED',
  'FAILED',
  'STOPPED',
  'UNKNOWN',
  'DISCONNECTED',
])

export interface NotificationRecordInput {
  sessionId: string
  kind: string
  title: string
  body: string
  sentAt: number
}

function sessionHash(session: Session): string {
  return JSON.stringify([
    session.pid,
    session.cwd,
    session.projectName,
    session.status,
    session.statusReason,
    session.confidence,
    session.currentTool,
    session.lastError,
    session.attention,
    session.lastEventAt,
    session.lastActivityAt,
    session.lastAssistantMessage,
    session.exitKind,
    session.hookDriven,
  ])
}

function parseAttention(raw: string | null): Attention | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && 'type' in parsed) {
      return parsed as Attention
    }
  } catch {
    // ignore invalid history
  }
  return null
}

function normalizeStatus(raw: string): SessionStatus {
  return SESSION_STATUSES.has(raw) ? (raw as SessionStatus) : 'UNKNOWN'
}

export class PersistenceService {
  private timer: NodeJS.Timeout | null = null
  private pruneTimer: NodeJS.Timeout | null = null
  private flushPromise: Promise<void> | null = null
  private flushPending = false
  private stopped = false
  private readonly persistedEvents = new Map<string, Set<string>>()
  private readonly sessionHashes = new Map<string, string>()

  constructor(
    private readonly db: Database,
    private readonly getSessions: () => Session[],
    private readonly getRetentionDays: () => number,
    private readonly onError?: (message: string) => void,
  ) {}

  start(): void {
    this.pruneTimer = setInterval(() => {
      void this.prune()
    }, 6 * 60 * 60 * 1000)
  }

  scheduleFlush(): void {
    if (this.stopped || this.timer || this.flushPromise) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, 400)
  }

  async flush(): Promise<void> {
    if (this.flushPromise) {
      this.flushPending = true
      return this.flushPromise
    }
    this.flushPromise = this.doFlush()
      .catch((error) => {
        this.onError?.(`persistence-flush-failed: ${String(error)}`)
      })
      .finally(() => {
        this.flushPromise = null
        if (this.flushPending && !this.stopped) {
          this.flushPending = false
          void this.flush()
        }
      })
    return this.flushPromise
  }

  private async doFlush(): Promise<void> {
    const cutoff = Date.now() - this.getRetentionDays() * 24 * 60 * 60 * 1000
    const sessions = this.getSessions()

    for (const session of sessions) {
      if (
        session.lastActivityAt < cutoff &&
        (session.status === 'COMPLETED' ||
          session.status === 'STOPPED' ||
          session.status === 'FAILED')
      ) {
        continue
      }

      const hash = sessionHash(session)
      if (this.sessionHashes.get(session.sessionId) !== hash) {
        const values = {
          sessionId: session.sessionId,
          pid: session.pid,
          cwd: session.cwd,
          projectName: session.projectName,
          status: session.status,
          statusReason: session.statusReason,
          confidence: session.confidence,
          currentTool: session.currentTool,
          lastError: session.lastError,
          attention: session.attention ? JSON.stringify(session.attention) : null,
          startedAt: session.startedAt,
          lastEventAt: session.lastEventAt,
          lastActivityAt: session.lastActivityAt,
          lastAssistantMessage: null,
          exitKind: session.exitKind,
          hookDriven: session.hookDriven,
          updatedAt: Date.now(),
        }
        await this.db.orm
          .insert(sessionsTable)
          .values(values)
          .onConflictDoUpdate({
            target: sessionsTable.sessionId,
            set: values,
          })
        this.sessionHashes.set(session.sessionId, hash)
      }

      const known = this.persistedEvents.get(session.sessionId) ?? new Set<string>()
      this.persistedEvents.set(session.sessionId, known)
      const events = [...session.recentEvents].reverse()
      for (const event of events) {
        if (known.has(event.id)) continue
        await this.insertEvent(session.sessionId, event)
        known.add(event.id)
      }
    }
  }

  private async insertEvent(sessionId: string, event: SessionEventView): Promise<void> {
    await this.db.orm
      .insert(sessionEventsTable)
      .values({
        eventId: event.id,
        sessionId,
        name: event.name,
        at: event.at,
        summary: event.summary.slice(0, 1000),
        toolName: event.toolName,
        severity: event.severity,
      })
      .onConflictDoNothing()
  }

  async loadSessions(): Promise<Session[]> {
    const rows = await this.db.orm
      .select()
      .from(sessionsTable)
      .orderBy(desc(sessionsTable.lastActivityAt))
      .limit(100)

    const result: Session[] = []
    for (const row of rows) {
      const eventRows = await this.db.orm
        .select()
        .from(sessionEventsTable)
        .where(eq(sessionEventsTable.sessionId, row.sessionId))
        .orderBy(desc(sessionEventsTable.at))
        .limit(30)

      const events: SessionEventView[] = eventRows.map((event) => ({
        id: event.eventId,
        at: event.at,
        name: event.name,
        summary: event.summary,
        toolName: event.toolName,
        severity:
          event.severity === 'error' || event.severity === 'warning'
            ? event.severity
            : 'info',
      }))
      this.persistedEvents.set(row.sessionId, new Set(events.map((event) => event.id)))

      const wasActive = ACTIVE_STATUSES.has(row.status)
      const status = wasActive ? 'DISCONNECTED' : normalizeStatus(row.status)
      result.push({
        sessionId: row.sessionId,
        pid: null,
        cwd: row.cwd,
        projectName: row.projectName,
        status,
        statusReason: wasActive ? '应用重启，等待新的会话事件' : row.statusReason,
        confidence: wasActive ? 'low' : (row.confidence as Session['confidence']),
        currentTool: wasActive ? null : row.currentTool,
        lastError: row.lastError,
        attention: wasActive ? null : parseAttention(row.attention),
        startedAt: row.startedAt,
        lastEventAt: row.lastEventAt,
        lastActivityAt: row.lastActivityAt,
        lastAssistantMessage: row.lastAssistantMessage,
        recentEvents: events,
        alive: null,
        hookDriven: false,
        exitKind:
          row.exitKind === 'normal' || row.exitKind === 'abnormal'
            ? row.exitKind
            : null,
        sourceTerminal: null,
        procStart: null,
        waitingFor: null,
        sessionFileStatus: null,
        sessionFileUpdatedAt: null,
      })
    }
    return result
  }

  async loadSettings(): Promise<AppSettings | null> {
    const rows = await this.db.orm
      .select()
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, 'app'))
      .limit(1)
    const row = rows[0]
    if (!row) return null
    try {
      return normalizeSettings(JSON.parse(row.value) as unknown)
    } catch {
      return null
    }
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    const value = JSON.stringify(settings)
    await this.db.orm
      .insert(appSettingsTable)
      .values({ key: 'app', value, updatedAt: Date.now() })
      .onConflictDoUpdate({
        target: appSettingsTable.key,
        set: { value, updatedAt: Date.now() },
      })
  }

  async recordNotification(record: NotificationRecordInput): Promise<void> {
    try {
      await this.db.orm.insert(notificationsTable).values({
        sessionId: record.sessionId,
        kind: record.kind,
        title: record.title.slice(0, 300),
        body: record.body.slice(0, 1000),
        sentAt: record.sentAt,
      })
    } catch (error) {
      this.onError?.(`persistence-notification-failed: ${String(error)}`)
    }
  }

  async prune(): Promise<void> {
    if (this.stopped) return
    const cutoff = Date.now() - this.getRetentionDays() * 24 * 60 * 60 * 1000
    try {
      await this.db.orm
        .delete(sessionEventsTable)
        .where(lt(sessionEventsTable.at, cutoff))
      await this.db.orm
        .delete(notificationsTable)
        .where(lt(notificationsTable.sentAt, cutoff))
      await this.db.orm.delete(sessionsTable).where(
        and(
          lt(sessionsTable.lastActivityAt, cutoff),
          inArray(sessionsTable.status, ['COMPLETED', 'STOPPED', 'FAILED', 'DISCONNECTED']),
        ),
      )
    } catch (error) {
      this.onError?.(`persistence-prune-failed: ${String(error)}`)
    }
  }

  async clearHistory(): Promise<void> {
    await this.db.orm.delete(sessionEventsTable)
    await this.db.orm.delete(notificationsTable)
    await this.db.orm.delete(sessionsTable)
    this.persistedEvents.clear()
    this.sessionHashes.clear()
  }

  close(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.pruneTimer) clearInterval(this.pruneTimer)
    this.pruneTimer = null
    this.db.close()
  }
}
