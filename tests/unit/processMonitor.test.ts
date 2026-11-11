import { describe, expect, it } from 'vitest'
import type { Session } from '@shared/types/session'
import { ProcessMonitor } from '../../src/main/process/processMonitor'
import type { ProcessInfo } from '../../src/main/process/windowsQuery'

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: 'session-1',
    pid: 123,
    cwd: 'C:\\work',
    projectName: 'work',
    status: 'RUNNING',
    statusReason: '正在工作',
    confidence: 'high',
    currentTool: null,
    lastError: null,
    attention: null,
    startedAt: 1000,
    lastEventAt: 1000,
    lastActivityAt: 1000,
    lastAssistantMessage: null,
    recentEvents: [],
    alive: null,
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

function waitForSignal(): {
  promise: Promise<string>
  resolve: (value: string) => void
  reject: (error: Error) => void
} {
  let resolve!: (value: string) => void
  let reject!: (error: Error) => void
  const promise = new Promise<string>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function withTimeout(promise: Promise<string>): Promise<string> {
  return Promise.race([
    promise,
    new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error('process monitor test timed out')), 3000),
    ),
  ])
}

describe('ProcessMonitor', () => {
  it('reports a live claude process', async () => {
    const signal = waitForSignal()
    const processes = new Map<number, ProcessInfo>([
      [123, { pid: 123, name: 'claude', startTimeMs: 1000 }],
    ])
    const monitor = new ProcessMonitor({
      getSessions: () => [makeSession()],
      getIntervalMs: () => 60_000,
      query: async () => processes,
      onAlive: (sessionId) => signal.resolve(`alive:${sessionId}`),
      onDead: () => signal.reject(new Error('unexpected dead')),
      onUnknown: () => signal.reject(new Error('unexpected unknown')),
    })

    try {
      monitor.start()
      expect(await withTimeout(signal.promise)).toBe('alive:session-1')
    } finally {
      monitor.stop()
    }
  })

  it('reports a missing process and ignores unrelated process names', async () => {
    const signal = waitForSignal()
    const monitor = new ProcessMonitor({
      getSessions: () => [makeSession()],
      getIntervalMs: () => 60_000,
      query: async () => new Map(),
      onAlive: () => signal.reject(new Error('unexpected alive')),
      onDead: (sessionId) => signal.resolve(`dead:${sessionId}`),
      onUnknown: () => signal.reject(new Error('unexpected unknown')),
    })

    try {
      monitor.start()
      expect(await withTimeout(signal.promise)).toBe('dead:session-1')
    } finally {
      monitor.stop()
    }

    const wrongName = waitForSignal()
    const monitor2 = new ProcessMonitor({
      getSessions: () => [makeSession()],
      getIntervalMs: () => 60_000,
      query: async () =>
        new Map([[123, { pid: 123, name: 'node', startTimeMs: 1000 }]]),
      onAlive: () => wrongName.reject(new Error('unexpected alive')),
      onDead: (sessionId) => wrongName.resolve(`dead:${sessionId}`),
      onUnknown: () => wrongName.reject(new Error('unexpected unknown')),
    })
    try {
      monitor2.start()
      expect(await withTimeout(wrongName.promise)).toBe('dead:session-1')
    } finally {
      monitor2.stop()
    }
  })

  it('marks liveness unknown when the query fails', async () => {
    const signal = waitForSignal()
    const monitor = new ProcessMonitor({
      getSessions: () => [makeSession()],
      getIntervalMs: () => 60_000,
      query: async () => {
        throw new Error('powershell failed')
      },
      onAlive: () => signal.reject(new Error('unexpected alive')),
      onDead: () => signal.reject(new Error('unexpected dead')),
      onUnknown: (sessionId) => signal.resolve(`unknown:${sessionId}`),
    })

    try {
      monitor.start()
      expect(await withTimeout(signal.promise)).toBe('unknown:session-1')
    } finally {
      monitor.stop()
    }
  })
})
