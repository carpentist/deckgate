import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { NormalizedHookEvent } from '@shared/types/hooks'
import type { ClaudeSessionFile } from '../../src/main/process/sessionFiles'
import { SessionRegistry } from '../../src/main/session/registry'

function makeFile(overrides: Partial<ClaudeSessionFile> = {}): ClaudeSessionFile {
  return {
    pid: 123,
    sessionId: 'session-1',
    cwd: 'C:\\work\\project',
    startedAt: 1_000,
    updatedAt: 2_000,
    status: 'busy',
    waitingFor: null,
    procStart: null,
    version: '2.1.126',
    kind: 'interactive',
    entrypoint: 'cli',
    ...overrides,
  }
}

function makeEvent(overrides: Partial<NormalizedHookEvent> = {}): NormalizedHookEvent {
  return {
    eventId: randomUUID(),
    name: 'UserPromptSubmit',
    sessionId: 'session-1',
    cwd: 'C:\\work\\project',
    transcriptPath: null,
    receivedAt: 1_000,
    permissionMode: 'default',
    source: null,
    reason: null,
    toolName: null,
    toolUseId: null,
    error: null,
    notificationType: null,
    message: null,
    lastAssistantMessage: null,
    rawSize: 10,
    ...overrides,
  }
}

describe('SessionRegistry', () => {
  it('follows a complete turn: start, permission, failure, stop, end', () => {
    const registry = new SessionRegistry()

    registry.apply(makeEvent({ name: 'SessionStart', source: 'startup', receivedAt: 1_000 }))
    expect(registry.get('session-1')?.status).toBe('WAITING_INPUT')

    registry.apply(makeEvent({ name: 'UserPromptSubmit', receivedAt: 2_000 }))
    expect(registry.get('session-1')?.status).toBe('RUNNING')

    registry.apply(
      makeEvent({ name: 'PreToolUse', toolName: 'PowerShell', receivedAt: 3_000 }),
    )
    expect(registry.get('session-1')?.currentTool).toBe('PowerShell')

    registry.apply(
      makeEvent({
        name: 'PermissionRequest',
        toolName: 'PowerShell',
        receivedAt: 4_000,
      }),
    )
    const waiting = registry.get('session-1')
    expect(waiting?.status).toBe('WAITING_PERMISSION')
    expect(waiting?.attention?.type).toBe('permission')
    expect(waiting?.attention?.since).toBe(4_000)

    registry.apply(
      makeEvent({
        name: 'Notification',
        notificationType: 'permission_prompt',
        message: 'Claude needs your permission to use PowerShell',
        receivedAt: 5_000,
      }),
    )
    expect(waiting?.attention?.since).toBe(4_000)
    expect(waiting?.attention?.type).toBe('permission')

    registry.apply(
      makeEvent({
        name: 'PostToolUseFailure',
        toolName: 'PowerShell',
        error: 'Exit code 1',
        receivedAt: 6_000,
      }),
    )
    expect(registry.get('session-1')?.status).toBe('RUNNING')
    expect(registry.get('session-1')?.lastError).toBe('Exit code 1')
    expect(registry.get('session-1')?.attention).toBeNull()

    registry.apply(
      makeEvent({
        name: 'Stop',
        lastAssistantMessage: 'Done',
        receivedAt: 7_000,
      }),
    )
    expect(registry.get('session-1')?.status).toBe('COMPLETED')
    expect(registry.get('session-1')?.lastAssistantMessage).toBe('Done')

    registry.apply(
      makeEvent({
        name: 'Notification',
        notificationType: 'idle_prompt',
        message: 'Claude is waiting for your input',
        receivedAt: 8_000,
      }),
    )
    expect(registry.get('session-1')?.status).toBe('COMPLETED')

    registry.apply(makeEvent({ name: 'SessionEnd', reason: 'other', receivedAt: 9_000 }))
    expect(registry.get('session-1')?.status).toBe('STOPPED')
  })

  it('clears permission attention when the tool completes', () => {
    const registry = new SessionRegistry()
    registry.apply(makeEvent({ name: 'SessionStart', receivedAt: 1_000 }))
    registry.apply(
      makeEvent({
        name: 'PermissionRequest',
        toolName: 'PowerShell',
        receivedAt: 2_000,
      }),
    )
    expect(registry.get('session-1')?.status).toBe('WAITING_PERMISSION')

    registry.apply(
      makeEvent({ name: 'PostToolUse', toolName: 'PowerShell', receivedAt: 3_000 }),
    )
    expect(registry.get('session-1')?.status).toBe('RUNNING')
    expect(registry.get('session-1')?.attention).toBeNull()
    expect(registry.get('session-1')?.currentTool).toBeNull()
  })

  it('clears permission attention immediately after an in-app decision', () => {
    const registry = new SessionRegistry()
    registry.apply(makeEvent({ name: 'SessionStart', receivedAt: 1_000 }))
    registry.apply(
      makeEvent({ name: 'PermissionRequest', toolName: 'PowerShell', receivedAt: 2_000 }),
    )

    registry.resolveApproval('session-1', 'allow')
    expect(registry.get('session-1')?.status).toBe('RUNNING')
    expect(registry.get('session-1')?.attention).toBeNull()
    expect(registry.get('session-1')?.statusReason).toContain('允许')
  })

  it('keeps attention when the approval falls back to the terminal', () => {
    const registry = new SessionRegistry()
    registry.apply(makeEvent({ name: 'SessionStart', receivedAt: 1_000 }))
    registry.apply(
      makeEvent({ name: 'PermissionRequest', toolName: 'PowerShell', receivedAt: 2_000 }),
    )

    registry.resolveApproval('session-1', 'fallback')
    expect(registry.get('session-1')?.status).toBe('WAITING_PERMISSION')
    expect(registry.get('session-1')?.attention?.type).toBe('permission')
    expect(registry.get('session-1')?.statusReason).toContain('回退')
  })

  it('treats waiting -> busy in the session file as approval completed', () => {
    const registry = new SessionRegistry()
    registry.apply(makeEvent({ name: 'SessionStart', receivedAt: 1_000 }))
    registry.apply(makeEvent({ name: 'UserPromptSubmit', receivedAt: 2_000 }))
    registry.apply(
      makeEvent({ name: 'PermissionRequest', toolName: 'PowerShell', receivedAt: 3_000 }),
    )
    registry.applySessionFile(
      makeFile({
        status: 'waiting',
        waitingFor: 'approve PowerShell',
        updatedAt: 4_000,
      }),
    )
    expect(registry.get('session-1')?.status).toBe('WAITING_PERMISSION')

    registry.applySessionFile(makeFile({ status: 'busy', updatedAt: 5_000 }))
    expect(registry.get('session-1')?.status).toBe('RUNNING')
    expect(registry.get('session-1')?.attention).toBeNull()
  })

  it('suppresses a permission wait when the request was auto-approved', () => {
    const registry = new SessionRegistry()
    const now = Date.now()

    registry.recordAutoApproval('session-1', 'PowerShell')
    registry.apply(makeEvent({ name: 'SessionStart', receivedAt: now - 3_000 }))
    registry.apply(makeEvent({ name: 'UserPromptSubmit', receivedAt: now - 2_000 }))
    registry.apply(
      makeEvent({
        name: 'PermissionRequest',
        toolName: 'PowerShell',
        receivedAt: Date.now(),
      }),
    )

    expect(registry.get('session-1')?.status).toBe('RUNNING')
    expect(registry.get('session-1')?.attention).toBeNull()
    expect(
      registry
        .get('session-1')
        ?.recentEvents.some((event) => event.summary.includes('已自动允许')),
    ).toBe(true)
  })

  it('clears an existing wait when auto-approval happens after the request event', () => {
    const registry = new SessionRegistry()
    const now = Date.now()
    registry.apply(makeEvent({ name: 'SessionStart', receivedAt: now - 2_000 }))
    registry.apply(
      makeEvent({
        name: 'PermissionRequest',
        toolName: 'PowerShell',
        receivedAt: now,
      }),
    )
    expect(registry.get('session-1')?.status).toBe('WAITING_PERMISSION')

    registry.recordAutoApproval('session-1', 'PowerShell')
    expect(registry.get('session-1')?.status).toBe('RUNNING')
    expect(registry.get('session-1')?.attention).toBeNull()
  })

  it('maps AskUserQuestion to WAITING_INPUT, not permission', () => {
    const registry = new SessionRegistry()
    registry.apply(makeEvent({ name: 'SessionStart', receivedAt: 1_000 }))
    registry.apply(
      makeEvent({
        name: 'PermissionRequest',
        toolName: 'AskUserQuestion',
        receivedAt: 2_000,
      }),
    )
    const session = registry.get('session-1')
    expect(session?.status).toBe('WAITING_INPUT')
    expect(session?.attention?.type).toBe('question')
  })

  it('uses idle prompts only when a Stop was missed', () => {
    const registry = new SessionRegistry()
    registry.apply(makeEvent({ name: 'SessionStart', receivedAt: 1_000 }))
    registry.apply(makeEvent({ name: 'UserPromptSubmit', receivedAt: 2_000 }))
    registry.apply(
      makeEvent({
        name: 'Notification',
        notificationType: 'idle_prompt',
        message: 'Claude is waiting for your input',
        receivedAt: 3_000,
      }),
    )
    expect(registry.get('session-1')?.status).toBe('WAITING_INPUT')
    expect(registry.get('session-1')?.attention?.type).toBe('idle')
  })

  it('ignores duplicate event ids', () => {
    const registry = new SessionRegistry()
    const stop = makeEvent({ name: 'Stop', receivedAt: 1_000 })
    expect(registry.apply(stop)).toBe(true)
    expect(registry.apply(stop)).toBe(false)
    expect(registry.get('session-1')?.recentEvents).toHaveLength(1)
  })

  it('does not apply stale out-of-order events to state', () => {
    const registry = new SessionRegistry()
    registry.apply(makeEvent({ name: 'SessionStart', receivedAt: 1_000 }))
    registry.apply(makeEvent({ name: 'Stop', receivedAt: 3_000 }))
    registry.apply(makeEvent({ name: 'UserPromptSubmit', receivedAt: 2_000 }))

    const session = registry.get('session-1')
    expect(session?.status).toBe('COMPLETED')
    expect(session?.lastEventAt).toBe(3_000)
    expect(session?.recentEvents).toHaveLength(3)
  })

  it('keeps two sessions with the same cwd separate', () => {
    const registry = new SessionRegistry()
    registry.apply(makeEvent({ sessionId: 'session-a', name: 'SessionStart', receivedAt: 1_000 }))
    registry.apply(makeEvent({ sessionId: 'session-b', name: 'SessionStart', receivedAt: 2_000 }))
    expect(registry.snapshot()).toHaveLength(2)
    expect(registry.snapshot().map((session) => session.sessionId).sort()).toEqual([
      'session-a',
      'session-b',
    ])
  })

  it('marks StopFailure as FAILED with attention', () => {
    const registry = new SessionRegistry()
    registry.apply(makeEvent({ name: 'UserPromptSubmit', receivedAt: 1_000 }))
    registry.apply(
      makeEvent({
        name: 'StopFailure',
        error: 'rate_limit',
        receivedAt: 2_000,
      }),
    )
    const session = registry.get('session-1')
    expect(session?.status).toBe('FAILED')
    expect(session?.attention?.type).toBe('failure')
    expect(session?.lastError).toBe('rate_limit')
  })

  it('creates an UNKNOWN session for an unrecognized event', () => {
    const registry = new SessionRegistry()
    registry.apply(makeEvent({ name: 'SomeFutureEvent', receivedAt: 1_000 }))
    expect(registry.get('session-1')?.status).toBe('UNKNOWN')
  })

  it('marks resume sessions as waiting for input', () => {
    const registry = new SessionRegistry()
    registry.apply(makeEvent({ name: 'SessionStart', source: 'resume', receivedAt: 1_000 }))
    expect(registry.get('session-1')?.statusReason).toContain('恢复')
  })

  it('restores a waiting session from a Claude session file', () => {
    const registry = new SessionRegistry()
    registry.applySessionFile(
      makeFile({ status: 'waiting', waitingFor: 'approve PowerShell' }),
    )
    const session = registry.get('session-1')
    expect(session?.status).toBe('WAITING_PERMISSION')
    expect(session?.pid).toBe(123)
    expect(session?.hookDriven).toBe(false)
    expect(session?.attention?.type).toBe('permission')
  })

  it('maps busy and idle session files', () => {
    const busy = new SessionRegistry()
    busy.applySessionFile(makeFile({ status: 'busy', sessionId: 'busy-1' }))
    expect(busy.get('busy-1')?.status).toBe('RUNNING')

    const idle = new SessionRegistry()
    idle.applySessionFile(makeFile({ status: 'idle', sessionId: 'idle-1' }))
    expect(idle.get('idle-1')?.status).toBe('WAITING_INPUT')
  })

  it('uses session-file waiting as a fallback and busy as recovery', () => {
    const registry = new SessionRegistry()
    registry.apply(makeEvent({ name: 'SessionStart', receivedAt: 1_000 }))
    registry.apply(makeEvent({ name: 'UserPromptSubmit', receivedAt: 2_000 }))
    registry.applySessionFile(
      makeFile({ status: 'waiting', waitingFor: 'approve PowerShell', updatedAt: 3_000 }),
    )
    expect(registry.get('session-1')?.status).toBe('WAITING_PERMISSION')

    registry.applySessionFile(makeFile({ status: 'busy', updatedAt: 4_000 }))
    expect(registry.get('session-1')?.status).toBe('RUNNING')
    expect(registry.get('session-1')?.attention).toBeNull()
  })

  it('does not override a completed hook state with a stale file', () => {
    const registry = new SessionRegistry()
    registry.apply(makeEvent({ name: 'SessionStart', receivedAt: 1_000 }))
    registry.apply(makeEvent({ name: 'Stop', receivedAt: 2_000 }))
    registry.applySessionFile(
      makeFile({ status: 'waiting', waitingFor: 'approve PowerShell', updatedAt: 3_000 }),
    )
    expect(registry.get('session-1')?.status).toBe('COMPLETED')
  })

  it('marks an unannounced process death as abnormal exactly once', () => {
    const registry = new SessionRegistry()
    registry.applySessionFile(makeFile({ status: 'busy' }))
    const first = registry.markProcessDead('session-1')
    expect(first).toEqual({ changed: true, abnormal: true })
    expect(registry.get('session-1')?.status).toBe('STOPPED')
    expect(registry.get('session-1')?.exitKind).toBe('abnormal')
    expect(registry.get('session-1')?.attention?.type).toBe('abnormal-exit')

    const second = registry.markProcessDead('session-1')
    expect(second.abnormal).toBe(false)
  })

  it('treats a process exit after SessionEnd as normal', () => {
    const registry = new SessionRegistry()
    registry.applySessionFile(makeFile({ status: 'busy' }))
    registry.apply(makeEvent({ name: 'SessionEnd', reason: 'other', receivedAt: 5_000 }))
    expect(registry.get('session-1')?.exitKind).toBe('normal')
    const result = registry.markProcessDead('session-1')
    expect(result.abnormal).toBe(false)
    expect(registry.get('session-1')?.status).toBe('STOPPED')
  })
})
