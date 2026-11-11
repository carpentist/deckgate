import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_APP_SETTINGS } from '@shared/types/settings'
import type { Session, SessionEventView } from '@shared/types/session'
import { Database } from '../../src/main/persistence/database'
import { PersistenceService } from '../../src/main/persistence/service'

let root: string
let database: Database
let service: PersistenceService
let sessions: Session[]

function makeEvent(id: string, at: number): SessionEventView {
  return {
    id,
    at,
    name: 'PreToolUse',
    summary: `调用 PowerShell (${id})`,
    toolName: 'PowerShell',
    severity: 'info',
  }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: 'session-1',
    pid: 1234,
    cwd: 'C:\\work\\project',
    projectName: 'project',
    status: 'RUNNING',
    statusReason: '正在使用 PowerShell',
    confidence: 'high',
    currentTool: 'PowerShell',
    lastError: null,
    attention: null,
    startedAt: 1000,
    lastEventAt: 2000,
    lastActivityAt: 2000,
    lastAssistantMessage: null,
    recentEvents: [makeEvent('e1', 1000), makeEvent('e2', 2000)],
    alive: true,
    hookDriven: true,
    exitKind: null,
    sourceTerminal: null,
    procStart: null,
    waitingFor: null,
    sessionFileStatus: null,
    sessionFileUpdatedAt: null,
    ...overrides,
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccw-persistence-'))
  database = new Database(join(root, 'watcher.db'))
  sessions = [makeSession()]
  service = new PersistenceService(
    database,
    () => sessions,
    () => 30,
    () => undefined,
  )
})

afterEach(async () => {
  service.close()
  await rm(root, { recursive: true, force: true })
})

describe('PersistenceService', () => {
  it('persists sessions and events idempotently and restores them safely', async () => {
    await service.flush()
    await service.flush()

    const eventCount = database.sqlite
      .prepare('SELECT COUNT(*) AS count FROM session_events')
      .get() as { count: number }
    expect(eventCount.count).toBe(2)

    const restored = await service.loadSessions()
    expect(restored).toHaveLength(1)
    expect(restored[0]).toMatchObject({
      sessionId: 'session-1',
      status: 'DISCONNECTED',
      pid: null,
      hookDriven: false,
    })
    expect(restored[0]?.recentEvents).toHaveLength(2)
  })

  it('round-trips settings and clears history', async () => {
    await service.saveSettings({ ...DEFAULT_APP_SETTINGS, miniMode: true })
    const settings = await service.loadSettings()
    expect(settings?.miniMode).toBe(true)

    await service.flush()
    await service.recordNotification({
      sessionId: 'session-1',
      kind: 'permission',
      title: 'project 需要授权',
      body: '工具 PowerShell 需要批准',
      sentAt: Date.now(),
    })

    const notifications = database.sqlite
      .prepare('SELECT COUNT(*) AS count FROM notifications')
      .get() as { count: number }
    expect(notifications.count).toBe(1)

    await service.clearHistory()
    const sessionsCount = database.sqlite
      .prepare('SELECT COUNT(*) AS count FROM sessions')
      .get() as { count: number }
    expect(sessionsCount.count).toBe(0)
  })
})
