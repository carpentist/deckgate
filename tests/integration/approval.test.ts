import { connect, type Socket } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type ApprovalRequestView,
} from '@shared/types/settings'
import {
  ApprovalCoordinator,
  getApprovalPipeName,
} from '../../src/main/approval/coordinator'

type Message = Record<string, unknown>

let root: string
let previousPipe: string | undefined
let settings: AppSettings

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

  it('auto-approves a tool only when its project is selected and not blacklisted', async () => {
    settings = {
      ...settings,
      autoApproveAll: true,
      autoApproveProjects: ['C:\\project'],
      autoApproveBlockedTools: [],
      autoApproveBlockedCommands: [],
    }
    let requestCalled = false
    let resolveAuto: (value: string) => void = () => undefined
    const autoApproved = new Promise<string>((resolve) => {
      resolveAuto = resolve
    })

    const coordinator = new ApprovalCoordinator({
      appDataDir: root,
      getSettings: () => settings,
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

  it('auto-approves any project when all projects are enabled', async () => {
    settings = {
      ...settings,
      autoApproveAll: true,
      autoApproveAllProjects: true,
      autoApproveProjects: [],
      autoApproveBlockedTools: [],
      autoApproveBlockedCommands: [],
    }
    let requestCalled = false
    let resolveAuto: (value: string) => void = () => undefined
    const autoApproved = new Promise<string>((resolve) => {
      resolveAuto = resolve
    })

    const coordinator = new ApprovalCoordinator({
      appDataDir: root,
      getSettings: () => settings,
      getSessionInfo: () => ({ projectName: 'other', cwd: 'C:\\other' }),
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
      await sendPermissionRequest(socket, token, {
        requestId: 'req-all-projects',
        cwd: 'C:\\other',
      })

      const response = await withTimeout(
        reader.next((message) => message.type === 'decision'),
      )
      expect(response).toMatchObject({
        type: 'decision',
        requestId: 'req-all-projects',
        behavior: 'allow',
      })
      expect(await withTimeout(autoApproved)).toBe('session-1')
      expect(requestCalled).toBe(false)
    } finally {
      socket.destroy()
      coordinator.stop()
    }
  })

  it('keeps a manual card when the project is not selected', async () => {
    settings = {
      ...settings,
      autoApproveAll: true,
      autoApproveProjects: ['C:\\other-project'],
    }
    let resolveRequest: (view: ApprovalRequestView) => void = () => undefined
    const requestReceived = new Promise<ApprovalRequestView>((resolve) => {
      resolveRequest = resolve
    })

    const coordinator = new ApprovalCoordinator({
      appDataDir: root,
      getSettings: () => settings,
      getSessionInfo: () => ({ projectName: 'project', cwd: 'C:\\project' }),
      onRequestsChanged: () => undefined,
      onRequest: (request) => resolveRequest(request),
    })
    await coordinator.start()

    const socket = await connectClient()
    try {
      const reader = createMessageReader(socket)
      const token = (await readFile(join(root, 'approval-token.txt'), 'utf8')).trim()
      await sendPermissionRequest(socket, token, { requestId: 'req-project' })

      const request = await withTimeout(requestReceived)
      expect(request.autoApproveBlockedReason).toBe('当前项目未加入自动授权')
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

  it('keeps a manual card when a blocked command matches', async () => {
    settings = {
      ...settings,
      autoApproveAll: true,
      autoApproveProjects: ['C:\\project'],
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
        requestId: 'req-command',
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
})
