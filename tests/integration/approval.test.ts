import { connect, type Socket } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_SESSION_POLICY,
  type AppSettings,
  type ApprovalRequestView,
  type SessionPolicyView,
} from '@shared/types/settings'
import {
  ApprovalCoordinator,
  getApprovalPipeName,
} from '../../src/main/approval/coordinator'

type Message = Record<string, unknown>

let root: string
let previousPipe: string | undefined
let settings: AppSettings
let policy: SessionPolicyView

function withTimeout<T>(promise: Promise<T>, timeoutMs = 3000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('approval test timed out')), timeoutMs),
    ),
  ])
}

async function connectClient(): Promise<Socket> {
  const socket = connect(getApprovalPipeName())
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  socket.setEncoding('utf8')
  return socket
}

function createMessageReader(socket: Socket): {
  next: (predicate: (message: Message) => boolean, timeoutMs?: number) => Promise<Message>
} {
  let buffer = ''
  const queue: Message[] = []
  const waiters: {
    predicate: (message: Message) => boolean
    resolve: (message: Message) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }[] = []

  socket.on('data', (chunk: string) => {
    buffer += chunk
    let newline: number
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (!line.trim()) continue
      let message: Message
      try {
        message = JSON.parse(line) as Message
      } catch {
        continue
      }
      const index = waiters.findIndex((waiter) => waiter.predicate(message))
      if (index >= 0) {
        const [waiter] = waiters.splice(index, 1)
        if (!waiter) continue
        clearTimeout(waiter.timer)
        waiter.resolve(message)
      } else {
        queue.push(message)
      }
    }
  })

  socket.on('error', () => {
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('socket error'))
    }
  })

  return {
    next(predicate, timeoutMs = 3000) {
      const index = queue.findIndex(predicate)
      if (index >= 0) {
        const [message] = queue.splice(index, 1)
        return Promise.resolve(message as Message)
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const waiterIndex = waiters.findIndex((waiter) => waiter.resolve === resolve)
          if (waiterIndex >= 0) waiters.splice(waiterIndex, 1)
          reject(new Error('waiting for message timed out'))
        }, timeoutMs)
        waiters.push({ predicate, resolve, reject, timer })
      })
    },
  }
}

async function sendPermissionRequest(
  socket: Socket,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  socket.write(
    `${JSON.stringify({
      type: 'permission_request',
      token,
      requestId: 'req-1',
      sessionId: 'session-1',
      cwd: 'C:\\project',
      permissionMode: 'default',
      toolName: 'PowerShell',
      toolInput: { command: 'git status' },
      receivedAt: Date.now(),
      ...overrides,
    })}\n`,
  )
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'deckgate-approval-'))
  previousPipe = process.env['DECKGATE_APPROVAL_PIPE']
  process.env['DECKGATE_APPROVAL_PIPE'] = `\\\\.\\pipe\\deckgate-approval-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  settings = { ...DEFAULT_APP_SETTINGS, approvalEnabled: true, approvalWaitSec: 600 }
  policy = { ...DEFAULT_SESSION_POLICY }
})

afterEach(async () => {
  if (previousPipe === undefined) delete process.env['DECKGATE_APPROVAL_PIPE']
  else process.env['DECKGATE_APPROVAL_PIPE'] = previousPipe
  await rm(root, { recursive: true, force: true })
})

describe('ApprovalCoordinator', () => {
  it('forwards an allow decision and keeps the gate alive with heartbeats', async () => {
    let resolveRequest: (view: ApprovalRequestView) => void = () => undefined
    let resolveDecision: (behavior: string) => void = () => undefined
    const requestReceived = new Promise<ApprovalRequestView>((resolve) => {
      resolveRequest = resolve
    })
    const decisionMade = new Promise<string>((resolve) => {
      resolveDecision = resolve
    })

    const coordinator = new ApprovalCoordinator({
      appDataDir: root,
      getSettings: () => settings,
      getSessionPolicy: () => policy,
      getSessionInfo: () => ({ projectName: 'project', cwd: 'C:\\project' }),
      onRequestsChanged: () => undefined,
      onRequest: (request) => resolveRequest(request),
      onDecision: (_request, behavior) => resolveDecision(behavior),
    })
    await coordinator.start()

    const socket = await connectClient()
    try {
      const reader = createMessageReader(socket)
      const token = (await readFile(join(root, 'approval-token.txt'), 'utf8')).trim()
      await sendPermissionRequest(socket, token)

      const request = await withTimeout(requestReceived)
      expect(request.inputPreview).toBe('git status')
      expect(request.projectName).toBe('project')
      expect(request.autoApproveBlockedReason).toBeNull()

      const heartbeat = await withTimeout(reader.next((message) => message.type === 'heartbeat'))
      expect(heartbeat.requestId).toBe('req-1')
      expect(coordinator.getRequests()).toHaveLength(1)

      expect(coordinator.decide('req-1', 'allow')).toBe(true)
      expect(await withTimeout(decisionMade)).toBe('allow')
      const response = await withTimeout(
        reader.next((message) => message.type === 'decision'),
      )
      expect(response).toMatchObject({
        type: 'decision',
        requestId: 'req-1',
        behavior: 'allow',
      })
      expect(coordinator.getRequests()).toHaveLength(0)
    } finally {
      socket.destroy()
      coordinator.stop()
    }
  })

  it('falls back to the terminal when pending requests are cancelled', async () => {
    let resolveRequest: (view: ApprovalRequestView) => void = () => undefined
    const requestReceived = new Promise<ApprovalRequestView>((resolve) => {
      resolveRequest = resolve
    })

    const coordinator = new ApprovalCoordinator({
      appDataDir: root,
      getSettings: () => settings,
      getSessionPolicy: () => policy,
      getSessionInfo: () => ({ projectName: 'project', cwd: 'C:\\project' }),
      onRequestsChanged: () => undefined,
      onRequest: (request) => resolveRequest(request),
    })
    await coordinator.start()

    const socket = await connectClient()
    try {
      const reader = createMessageReader(socket)
      const token = (await readFile(join(root, 'approval-token.txt'), 'utf8')).trim()
      await sendPermissionRequest(socket, token, { requestId: 'req-2' })
      await withTimeout(requestReceived)

      coordinator.cancelAll()
      const response = await withTimeout(
        reader.next((message) => message.type === 'fallback'),
      )
      expect(response).toMatchObject({ type: 'fallback', requestId: 'req-2' })
    } finally {
      socket.destroy()
      coordinator.stop()
    }
  })

  it('auto-approves when the session policy is enabled and no blacklist matches', async () => {
    policy = { autoApprove: true, blockedTools: [], blockedCommands: [] }
    let requestCalled = false
    let resolveAuto: (value: string) => void = () => undefined
    const autoApproved = new Promise<string>((resolve) => {
      resolveAuto = resolve
    })

    const coordinator = new ApprovalCoordinator({
      appDataDir: root,
      getSettings: () => settings,
      getSessionPolicy: () => policy,
      getSessionInfo: () => ({ projectName: 'project', cwd: 'C:\\project' }),
      onRequestsChanged: () => undefined,
      onRequest: () => {
        requestCalled = true
      },
      onAutoApproved: (sessionId) => resolveAuto(sessionId),
    })
    await coordinator.start()

    const socket = await connectClient()
    try {
      const reader = createMessageReader(socket)
      const token = (await readFile(join(root, 'approval-token.txt'), 'utf8')).trim()
      await sendPermissionRequest(socket, token, { requestId: 'req-auto' })

      const response = await withTimeout(
        reader.next((message) => message.type === 'decision'),
      )
      expect(response).toMatchObject({
        type: 'decision',
        requestId: 'req-auto',
        behavior: 'allow',
      })
      expect(await withTimeout(autoApproved)).toBe('session-1')
      expect(requestCalled).toBe(false)
      expect(coordinator.getRequests()).toHaveLength(0)
    } finally {
      socket.destroy()
      coordinator.stop()
    }
  })

  it('keeps a manual card when the session policy is off', async () => {
    policy = { autoApprove: false, blockedTools: [], blockedCommands: [] }
    let resolveRequest: (view: ApprovalRequestView) => void = () => undefined
    const requestReceived = new Promise<ApprovalRequestView>((resolve) => {
      resolveRequest = resolve
    })

    const coordinator = new ApprovalCoordinator({
      appDataDir: root,
      getSettings: () => settings,
      getSessionPolicy: () => policy,
      getSessionInfo: () => ({ projectName: 'project', cwd: 'C:\\project' }),
      onRequestsChanged: () => undefined,
      onRequest: (request) => resolveRequest(request),
    })
    await coordinator.start()

    const socket = await connectClient()
    try {
      const reader = createMessageReader(socket)
      const token = (await readFile(join(root, 'approval-token.txt'), 'utf8')).trim()
      await sendPermissionRequest(socket, token, { requestId: 'req-manual' })

      const request = await withTimeout(requestReceived)
      expect(request.permissionMode).toBe('default')
      expect(request.autoApproveBlockedReason).toBeNull()
      coordinator.cancelAll()
      const response = await withTimeout(
        reader.next((message) => message.type === 'fallback'),
      )
      expect(response.type).toBe('fallback')
    } finally {
      socket.destroy()
      coordinator.stop()
    }
  })

  it('falls back without a card when Claude is in auto mode', async () => {
    policy = { autoApprove: true, blockedTools: [], blockedCommands: [] }
    let requestCalled = false

    const coordinator = new ApprovalCoordinator({
      appDataDir: root,
      getSettings: () => settings,
      getSessionPolicy: () => policy,
      getSessionInfo: () => ({ projectName: 'project', cwd: 'C:\\project' }),
      onRequestsChanged: () => undefined,
      onRequest: () => {
        requestCalled = true
      },
    })
    await coordinator.start()

    const socket = await connectClient()
    try {
      const reader = createMessageReader(socket)
      const token = (await readFile(join(root, 'approval-token.txt'), 'utf8')).trim()
      await sendPermissionRequest(socket, token, {
        requestId: 'req-auto-mode',
        permissionMode: 'auto',
      })

      const response = await withTimeout(
        reader.next((message) => message.type === 'fallback'),
      )
      expect(response.type).toBe('fallback')
      expect(requestCalled).toBe(false)
      expect(coordinator.getRequests()).toHaveLength(0)
    } finally {
      socket.destroy()
      coordinator.stop()
    }
  })

  it('falls back from the session mode when an older gate omits permissionMode', async () => {
    policy = { autoApprove: true, blockedTools: [], blockedCommands: [] }
    let requestCalled = false

    const coordinator = new ApprovalCoordinator({
      appDataDir: root,
      getSettings: () => settings,
      getSessionPolicy: () => policy,
      getSessionInfo: () => ({
        projectName: 'project',
        cwd: 'C:\\project',
        permissionMode: 'auto',
      }),
      onRequestsChanged: () => undefined,
      onRequest: () => {
        requestCalled = true
      },
    })
    await coordinator.start()

    const socket = await connectClient()
    try {
      const reader = createMessageReader(socket)
      const token = (await readFile(join(root, 'approval-token.txt'), 'utf8')).trim()
      await sendPermissionRequest(socket, token, {
        requestId: 'req-session-mode',
        permissionMode: null,
      })

      const response = await withTimeout(
        reader.next((message) => message.type === 'fallback'),
      )
      expect(response.type).toBe('fallback')
      expect(requestCalled).toBe(false)
    } finally {
      socket.destroy()
      coordinator.stop()
    }
  })

  it('falls back when the global master is off', async () => {
    settings = { ...settings, approvalEnabled: false }
    policy = { autoApprove: true, blockedTools: [], blockedCommands: [] }

    const coordinator = new ApprovalCoordinator({
      appDataDir: root,
      getSettings: () => settings,
      getSessionPolicy: () => policy,
      getSessionInfo: () => ({ projectName: 'project', cwd: 'C:\\project' }),
      onRequestsChanged: () => undefined,
      onRequest: () => undefined,
    })
    await coordinator.start()

    const socket = await connectClient()
    try {
      const reader = createMessageReader(socket)
      const token = (await readFile(join(root, 'approval-token.txt'), 'utf8')).trim()
      await sendPermissionRequest(socket, token, { requestId: 'req-master-off' })

      const response = await withTimeout(
        reader.next((message) => message.type === 'fallback'),
      )
      expect(response.type).toBe('fallback')
      expect(coordinator.getRequests()).toHaveLength(0)
    } finally {
      socket.destroy()
      coordinator.stop()
    }
  })

  it('keeps a manual card when the global blacklist matches', async () => {
    policy = { autoApprove: true, blockedTools: [], blockedCommands: [] }
    settings = {
      ...settings,
      autoApproveBlockedTools: [],
      autoApproveBlockedCommands: ['rm -rf'],
    }
    let resolveRequest: (view: ApprovalRequestView) => void = () => undefined
    const requestReceived = new Promise<ApprovalRequestView>((resolve) => {
      resolveRequest = resolve
    })

    const coordinator = new ApprovalCoordinator({
      appDataDir: root,
      getSettings: () => settings,
      getSessionPolicy: () => policy,
      getSessionInfo: () => ({ projectName: 'project', cwd: 'C:\\project' }),
      onRequestsChanged: () => undefined,
      onRequest: (request) => resolveRequest(request),
    })
    await coordinator.start()

    const socket = await connectClient()
    try {
      const reader = createMessageReader(socket)
      const token = (await readFile(join(root, 'approval-token.txt'), 'utf8')).trim()
      await sendPermissionRequest(socket, token, {
        requestId: 'req-global-command',
        toolInput: { command: 'rm -rf C:\\data' },
      })

      const request = await withTimeout(requestReceived)
      expect(request.autoApproveBlockedReason).toContain('rm -rf')
      coordinator.cancelAll()
      const response = await withTimeout(
        reader.next((message) => message.type === 'fallback'),
      )
      expect(response.type).toBe('fallback')
    } finally {
      socket.destroy()
      coordinator.stop()
    }
  })

  it('keeps a manual card when a session blacklist matches', async () => {
    policy = {
      autoApprove: true,
      blockedTools: [],
      blockedCommands: ['npm publish'],
    }
    let resolveRequest: (view: ApprovalRequestView) => void = () => undefined
    const requestReceived = new Promise<ApprovalRequestView>((resolve) => {
      resolveRequest = resolve
    })

    const coordinator = new ApprovalCoordinator({
      appDataDir: root,
      getSettings: () => settings,
      getSessionPolicy: () => policy,
      getSessionInfo: () => ({ projectName: 'project', cwd: 'C:\\project' }),
      onRequestsChanged: () => undefined,
      onRequest: (request) => resolveRequest(request),
    })
    await coordinator.start()

    const socket = await connectClient()
    try {
      const reader = createMessageReader(socket)
      const token = (await readFile(join(root, 'approval-token.txt'), 'utf8')).trim()
      await sendPermissionRequest(socket, token, {
        requestId: 'req-session-command',
        toolInput: { command: 'npm publish --access public' },
      })

      const request = await withTimeout(requestReceived)
      expect(request.autoApproveBlockedReason).toContain('本会话')
      expect(request.autoApproveBlockedReason).toContain('npm publish')
      coordinator.cancelAll()
      const response = await withTimeout(
        reader.next((message) => message.type === 'fallback'),
      )
      expect(response.type).toBe('fallback')
    } finally {
      socket.destroy()
      coordinator.stop()
    }
  })
})
