import { randomBytes, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { join } from 'node:path'
import {
  findBlockedCommand,
  findBlockedTool,
  getToolCommand,
  isProjectAutoApproved,
} from '@shared/autoApprove'
import type { AppSettings, ApprovalRequestView } from '@shared/types/settings'

const MAX_REQUEST_BYTES = 512 * 1024
const MAX_PREVIEW_LENGTH = 4000
const HEARTBEAT_INTERVAL_MS = 1000

export type ApprovalBehavior = 'allow' | 'deny' | 'fallback'

interface PendingApproval {
  view: ApprovalRequestView
  socket: Socket
  timer: NodeJS.Timeout
  heartbeatTimer: NodeJS.Timeout
}

interface ApprovalCoordinatorOptions {
  appDataDir: string
  getSettings: () => AppSettings
  getSessionInfo: (
    sessionId: string,
    cwd: string | null,
  ) => { projectName: string; cwd: string }
  onRequestsChanged: () => void
  onRequest: (request: ApprovalRequestView) => void
  onDecision?: (request: ApprovalRequestView, behavior: ApprovalBehavior) => void
  onAutoApproved?: (sessionId: string, toolName: string) => void
  onError?: (message: string) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getApprovalPipeName(): string {
  const override = process.env['DECKGATE_APPROVAL_PIPE']
  if (override) return override
  const username = (process.env['USERNAME'] ?? process.env['USER'] ?? 'user').replace(
    /[^A-Za-z0-9_.-]/g,
    '_',
  )
  return `\\\\.\\pipe\\deckgate-approval-${username}`
}

function sanitizeText(value: string, maxLength: number): string {
  let out = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code === 9 || code === 10 || code === 13) {
      out += char
      continue
    }
    if (code < 32 || code === 127) continue
    out += char
  }
  return out.slice(0, maxLength)
}

function formatToolInput(input: unknown): string {
  let text: string
  if (isRecord(input)) {
    const command = input['command']
    if (typeof command === 'string') {
      text = command
    } else {
      const filePath = input['file_path'] ?? input['path']
      if (typeof filePath === 'string') {
        text = filePath
      } else {
        text = safeJson(input)
      }
    }
  } else {
    text = safeJson(input)
  }
  const cleaned = sanitizeText(text, MAX_PREVIEW_LENGTH).trim()
  return cleaned || '(无参数)'
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

export class ApprovalCoordinator {
  private server: Server | null = null
  private token = ''
  private readonly pending = new Map<string, PendingApproval>()

  constructor(private readonly options: ApprovalCoordinatorOptions) {}

  getRequests(): ApprovalRequestView[] {
    return [...this.pending.values()]
      .map((pending) => pending.view)
      .sort((a, b) => a.receivedAt - b.receivedAt)
  }

  async start(): Promise<void> {
    await fs.mkdir(this.options.appDataDir, { recursive: true })
    this.token = await this.loadOrCreateToken()

    await new Promise<void>((resolve, reject) => {
      const server = createServer((socket) => this.handleSocket(socket))
      server.once('error', reject)
      server.listen(getApprovalPipeName(), () => {
        server.removeListener('error', reject)
        server.on('error', (error) => {
          this.options.onError?.(`approval-server-error: ${String(error)}`)
        })
        this.server = server
        resolve()
      })
    })
  }

  stop(): void {
    for (const pending of [...this.pending.values()]) this.finish(pending, 'fallback')
    this.server?.close()
    this.server = null
  }

  cancelAll(): void {
    for (const pending of [...this.pending.values()]) this.finish(pending, 'fallback')
  }

  decide(requestId: string, behavior: ApprovalBehavior): boolean {
    const pending = this.pending.get(requestId)
    if (!pending) return false
    this.finish(pending, behavior)
    return true
  }

  private async loadOrCreateToken(): Promise<string> {
    const tokenPath = join(this.options.appDataDir, 'approval-token.txt')
    try {
      const existing = (await fs.readFile(tokenPath, 'utf8')).trim()
      if (/^[a-f0-9]{32,}$/i.test(existing)) return existing
    } catch {
      // create below
    }
    const token = randomBytes(32).toString('hex')
    await fs.writeFile(tokenPath, `${token}\n`, { encoding: 'utf8', mode: 0o600 })
    return token
  }

  private handleSocket(socket: Socket): void {
    socket.setEncoding('utf8')
    let buffer = ''
    let handled = false

    const onClose = (): void => {
      for (const pending of [...this.pending.values()]) {
        if (pending.socket === socket) {
          this.pending.delete(pending.view.requestId)
          clearTimeout(pending.timer)
          clearInterval(pending.heartbeatTimer)
          this.options.onRequestsChanged()
        }
      }
    }

    socket.on('close', onClose)
    socket.on('error', () => {
      // close handler cleans pending requests
    })
    socket.on('data', (chunk: string) => {
      if (handled) return
      buffer += chunk
      if (buffer.length > MAX_REQUEST_BYTES) {
        socket.destroy()
        return
      }
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      handled = true
      this.handleRequest(socket, buffer.slice(0, newline))
    })
  }

  private handleRequest(socket: Socket, line: string): void {
    let message: unknown
    try {
      message = JSON.parse(line)
    } catch {
      socket.destroy()
      return
    }
    if (!isRecord(message) || message['type'] !== 'permission_request') {
      socket.destroy()
      return
    }
    if (!this.verifyToken(message['token'])) {
      socket.destroy()
      return
    }

    if (!this.options.getSettings().approvalEnabled) {
      this.sendFallback(socket)
      return
    }

    const requestId = message['requestId']
    const sessionId = message['sessionId']
    const toolName = message['toolName']
    const toolInput = message['toolInput']
    const cwd = typeof message['cwd'] === 'string' ? message['cwd'] : null

    if (
      typeof requestId !== 'string' ||
      requestId.length === 0 ||
      requestId.length > 120 ||
      typeof sessionId !== 'string' ||
      sessionId.length === 0 ||
      typeof toolName !== 'string' ||
      toolName.length === 0 ||
      toolInput === undefined ||
      toolName === 'AskUserQuestion' ||
      this.pending.has(requestId)
    ) {
      this.sendFallback(socket)
      return
    }

    const settings = this.options.getSettings()
    const timeoutMs = Math.min(600_000, Math.max(60_000, settings.approvalWaitSec * 1000))
    const receivedAt = Date.now()
    const sessionInfo = this.options.getSessionInfo(sessionId, cwd)
    let autoApproveBlockedReason: string | null = null

    if (settings.approvalEnabled && settings.autoApproveAll) {
      const projectAllowed =
        settings.autoApproveAllProjects ||
        isProjectAutoApproved(sessionInfo.cwd || cwd, settings.autoApproveProjects)
      if (!projectAllowed) {
        autoApproveBlockedReason = '当前项目未加入自动授权'
      } else {
        const blockedTool = findBlockedTool(toolName, settings.autoApproveBlockedTools)
        if (blockedTool) {
          autoApproveBlockedReason = `工具 ${blockedTool} 在自动授权黑名单中`
        } else {
          const command = getToolCommand(toolInput)
          const blockedCommand = command
            ? findBlockedCommand(command, settings.autoApproveBlockedCommands)
            : null
          if (blockedCommand) {
            autoApproveBlockedReason = `命中危险命令规则：${blockedCommand}`
          } else {
            this.sendDecision(socket, requestId, 'allow')
            this.options.onAutoApproved?.(sessionId, toolName)
            return
          }
        }
      }
    }

    const view: ApprovalRequestView = {
      requestId,
      sessionId,
      projectName: sessionInfo.projectName,
      cwd: sessionInfo.cwd,
      toolName,
      inputPreview: formatToolInput(toolInput),
      receivedAt,
      expiresAt: receivedAt + timeoutMs,
      autoApproveBlockedReason,
    }

    const pending: PendingApproval = {
      view,
      socket,
      timer: null as unknown as NodeJS.Timeout,
      heartbeatTimer: null as unknown as NodeJS.Timeout,
    }
    pending.timer = setTimeout(() => this.finish(pending, 'fallback'), timeoutMs)
    pending.heartbeatTimer = setInterval(
      () => this.sendHeartbeat(pending),
      HEARTBEAT_INTERVAL_MS,
    )
    this.sendHeartbeat(pending)
    this.pending.set(requestId, pending)
    this.options.onRequestsChanged()
    this.options.onRequest(view)
  }

  private sendHeartbeat(pending: PendingApproval): void {
    if (pending.socket.destroyed) return
    try {
      pending.socket.write(
        `${JSON.stringify({
          type: 'heartbeat',
          requestId: pending.view.requestId,
        })}\n`,
      )
    } catch {
      // the socket close handler removes the pending request
    }
  }

  private verifyToken(value: unknown): boolean {
    if (typeof value !== 'string' || !this.token) return false
    const provided = Buffer.from(value)
    const expected = Buffer.from(this.token)
    return provided.length === expected.length && timingSafeEqual(provided, expected)
  }

  private finish(pending: PendingApproval, behavior: ApprovalBehavior): void {
    if (this.pending.get(pending.view.requestId) !== pending) return
    this.pending.delete(pending.view.requestId)
    clearTimeout(pending.timer)
    clearInterval(pending.heartbeatTimer)

    try {
      if (!pending.socket.destroyed) {
        const response =
          behavior === 'fallback'
            ? { type: 'fallback', requestId: pending.view.requestId }
            : {
                type: 'decision',
                requestId: pending.view.requestId,
                behavior,
                message:
                  behavior === 'deny' ? '已由 Deckgate 拒绝' : undefined,
              }
        pending.socket.write(`${JSON.stringify(response)}\n`)
        pending.socket.end()
      }
    } catch {
      // the hook may already have exited
    }

    this.options.onDecision?.(pending.view, behavior)
    this.options.onRequestsChanged()
  }

  private sendDecision(
    socket: Socket,
    requestId: string,
    behavior: 'allow' | 'deny' | 'fallback',
    message?: string,
  ): void {
    try {
      socket.write(
        `${JSON.stringify({ type: 'decision', requestId, behavior, message })}\n`,
      )
      socket.end()
    } catch {
      socket.destroy()
    }
  }

  private sendFallback(socket: Socket): void {
    try {
      socket.write(`${JSON.stringify({ type: 'fallback' })}\n`)
      socket.end()
    } catch {
      socket.destroy()
    }
  }
}
