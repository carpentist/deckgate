import { basename } from 'node:path'
import type {
  Attention,
  EventSeverity,
  Session,
  SessionEventView,
  SessionStatus,
} from '@shared/types/session'
import type { NormalizedHookEvent } from '@shared/types/hooks'
import type { ClaudeSessionFile } from '../process/sessionFiles'

const MAX_RECENT_EVENTS = 80
const MAX_SEEN_EVENT_IDS = 1000
const NOTIFICATION_DEDUPE_MS = 15_000

function projectNameFromCwd(cwd: string): string {
  if (!cwd) return '未知目录'
  const normalized = cwd.replace(/[\\/]+$/, '')
  return basename(normalized) || normalized || '未知目录'
}

function summarize(event: NormalizedHookEvent): { summary: string; severity: EventSeverity } {
  const tool = event.toolName ?? '工具'
  switch (event.name) {
    case 'SessionStart':
      return { summary: `会话启动（${event.source ?? 'startup'}）`, severity: 'info' }
    case 'UserPromptSubmit':
      return { summary: '提交了新提示词', severity: 'info' }
    case 'PreToolUse':
      return { summary: `调用 ${tool}`, severity: 'info' }
    case 'PostToolUse':
      return { summary: `完成 ${tool}`, severity: 'info' }
    case 'PostToolUseFailure':
      return { summary: `工具失败：${event.error ?? '未知错误'}`, severity: 'error' }
    case 'PermissionRequest':
      return {
        summary:
          event.toolName === 'AskUserQuestion' ? '等待你回答问题' : `等待授权：${tool}`,
        severity: 'warning',
      }
    case 'Notification':
      return {
        summary: event.message ?? `通知（${event.notificationType ?? 'unknown'}）`,
        severity: event.notificationType === 'permission_prompt' ? 'warning' : 'info',
      }
    case 'Stop':
      return { summary: '当前回合完成', severity: 'info' }
    case 'StopFailure':
      return { summary: `执行失败：${event.error ?? '未知错误'}`, severity: 'error' }
    case 'SessionEnd':
      return { summary: `会话结束（${event.reason ?? 'unknown'}）`, severity: 'info' }
    default:
      return { summary: `事件 ${event.name}`, severity: 'info' }
  }
}

function buildAttention(event: NormalizedHookEvent): Attention | null {
  const tool = event.toolName
  switch (event.name) {
    case 'PermissionRequest':
      if (tool === 'AskUserQuestion') {
        return {
          type: 'question',
          since: event.receivedAt,
          toolName: tool,
          reason: '需要你回到原终端回答问题',
        }
      }
      return {
        type: 'permission',
        since: event.receivedAt,
        toolName: tool,
        reason: `需要你回到原终端批准 ${tool ?? '工具调用'}`,
      }
    case 'Notification':
      if (event.notificationType === 'permission_prompt') {
        return {
          type: 'permission',
          since: event.receivedAt,
          toolName: null,
          reason: event.message ?? '需要你回到原终端处理权限请求',
        }
      }
      if (event.notificationType === 'idle_prompt') {
        return {
          type: 'idle',
          since: event.receivedAt,
          toolName: null,
          reason: 'Claude 已空闲 60 秒，可能需要你的输入',
        }
      }
      return null
    case 'StopFailure':
      return {
        type: 'failure',
        since: event.receivedAt,
        toolName: null,
        reason: event.error ?? 'Claude Code 报告执行失败',
      }
    default:
      return null
  }
}

function setStatus(session: Session, status: SessionStatus, reason: string): void {
  session.status = status
  session.statusReason = reason
  session.confidence = 'high'
}

function deriveFileStatus(file: ClaudeSessionFile): {
  status: SessionStatus
  reason: string
  attention: Attention | null
} {
  const status = (file.status ?? '').toLowerCase()
  const waitingFor = file.waitingFor
  const since = file.updatedAt ?? file.startedAt

  if (status === 'waiting' || waitingFor) {
    const text = `${status} ${waitingFor ?? ''}`.toLowerCase()
    const approval =
      text.includes('approve') || text.includes('permission') || text.includes('allow')
    if (approval) {
      const reason = waitingFor ? `等待授权（${waitingFor}）` : '等待授权'
      return {
        status: 'WAITING_PERMISSION',
        reason,
        attention: { type: 'permission', since, toolName: null, reason },
      }
    }
    const reason = waitingFor ? `等待输入（${waitingFor}）` : '等待输入'
    return {
      status: 'WAITING_INPUT',
      reason,
      attention: { type: 'question', since, toolName: null, reason },
    }
  }

  if (status === 'busy') {
    return { status: 'RUNNING', reason: '正在工作（来自会话文件）', attention: null }
  }
  if (status === 'idle') {
    return { status: 'WAITING_INPUT', reason: '会话空闲，等待输入', attention: null }
  }
  return {
    status: 'UNKNOWN',
    reason: status ? `会话文件状态未知（${status}）` : '无法从会话文件判断状态',
    attention: null,
  }
}

export class SessionRegistry {
  private readonly sessions = new Map<string, Session>()
  private readonly seenEventIds = new Set<string>()
  private readonly seenEventOrder: string[] = []
  private readonly listeners = new Set<() => void>()
  private readonly autoApprovals = new Map<string, { toolName: string | null; at: number }>()

  apply(event: NormalizedHookEvent): boolean {
    if (this.seenEventIds.has(event.eventId)) return false
    this.markSeen(event.eventId)

    let session = this.sessions.get(event.sessionId)
    if (!session) {
      session = this.createSession(event)
      this.sessions.set(event.sessionId, session)
    }

    if (event.cwd) {
      session.cwd = event.cwd
      session.projectName = projectNameFromCwd(event.cwd)
    }
    session.hookDriven = true

    const outOfOrder = session.lastEventAt > 0 && event.receivedAt < session.lastEventAt

    if (!outOfOrder) {
      session.lastEventAt = event.receivedAt
      session.lastActivityAt = event.receivedAt
      this.transition(session, event)
    }

    this.addTimelineEvent(session, event)
    this.emit()
    return true
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId)
  }

  snapshot(): Session[] {
    return [...this.sessions.values()]
      .map((session) => ({
        ...session,
        recentEvents: [...session.recentEvents],
      }))
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  touch(): void {
    this.emit()
  }

  restore(sessions: Session[]): void {
    let added = false
    for (const session of sessions) {
      if (this.sessions.has(session.sessionId)) continue
      this.sessions.set(session.sessionId, {
        ...session,
        recentEvents: [...session.recentEvents],
      })
      added = true
    }
    if (added) this.emit()
  }

  clear(): void {
    this.sessions.clear()
    this.seenEventIds.clear()
    this.seenEventOrder.length = 0
    this.emit()
  }

  applySessionFile(file: ClaudeSessionFile): void {
    const existing = this.sessions.get(file.sessionId)
    const derived = deriveFileStatus(file)

    if (!existing) {
      const session: Session = {
        sessionId: file.sessionId,
        pid: file.pid,
        cwd: file.cwd,
        projectName: projectNameFromCwd(file.cwd),
        status: derived.status,
        statusReason: derived.reason,
        confidence: 'medium',
        currentTool: null,
        lastError: null,
        attention: derived.attention,
        startedAt: file.startedAt,
        lastEventAt: 0,
        lastActivityAt: file.updatedAt ?? file.startedAt,
        lastAssistantMessage: null,
        recentEvents: [
          {
            id: `session-file:${file.sessionId}:${file.updatedAt ?? file.startedAt}`,
            at: file.updatedAt ?? file.startedAt,
            name: 'SessionFile',
            summary: '从 Claude 会话文件恢复状态',
            toolName: null,
            severity: 'info',
          },
        ],
        alive: null,
        hookDriven: false,
        exitKind: null,
        sourceTerminal: null,
        procStart: file.procStart,
        waitingFor: file.waitingFor,
        sessionFileStatus: file.status,
        sessionFileUpdatedAt: file.updatedAt,
      }
      this.sessions.set(file.sessionId, session)
      this.emit()
      return
    }

    const previousFileStatus = existing.sessionFileStatus
    existing.pid = file.pid
    existing.cwd = file.cwd
    existing.projectName = projectNameFromCwd(file.cwd)
    existing.procStart = file.procStart
    existing.waitingFor = file.waitingFor
    existing.sessionFileStatus = file.status
    existing.sessionFileUpdatedAt = file.updatedAt
    if (file.updatedAt) {
      existing.lastActivityAt = Math.max(existing.lastActivityAt, file.updatedAt)
    }

    if (!existing.hookDriven) {
      existing.status = derived.status
      existing.statusReason = derived.reason
      existing.attention = derived.attention
      existing.confidence = 'medium'
    } else if (
      existing.status !== 'STOPPED' &&
      existing.status !== 'COMPLETED' &&
      existing.status !== 'FAILED'
    ) {
      if (derived.status === 'WAITING_PERMISSION' || derived.status === 'WAITING_INPUT') {
        existing.status = derived.status
        existing.statusReason = derived.reason
        existing.attention = derived.attention
        existing.confidence = 'medium'
      } else if (
        previousFileStatus === 'waiting' &&
        (file.status ?? '').toLowerCase() === 'busy' &&
        existing.attention !== null &&
        (existing.status === 'WAITING_PERMISSION' || existing.status === 'WAITING_INPUT')
      ) {
        setStatus(existing, 'RUNNING', '已恢复执行（来自会话文件）')
        existing.attention = null
        existing.confidence = 'medium'
      }
    }

    this.emit()
  }

  recordAutoApproval(sessionId: string, toolName: string): void {
    const at = Date.now()
    const session = this.sessions.get(sessionId)
    if (session && session.status === 'WAITING_PERMISSION') {
      setStatus(session, 'RUNNING', '已自动允许，等待工具结果')
      session.currentTool = toolName
      session.attention = null
      this.pushSyntheticEvent(
        session,
        `auto-approve:${sessionId}:${at}`,
        'AutoApprove',
        `已自动允许 ${toolName}`,
        'warning',
      )
      this.emit()
      return
    }
    this.autoApprovals.set(sessionId, { toolName, at })
  }

  resolveApproval(
    sessionId: string,
    behavior: 'allow' | 'deny' | 'fallback',
  ): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    if (behavior === 'fallback') {
      if (session.status === 'WAITING_PERMISSION') {
        session.statusReason = '已回退到原终端，等待你处理'
        session.confidence = 'medium'
        this.emit()
      }
      return
    }

    if (session.status !== 'WAITING_PERMISSION') return
    setStatus(
      session,
      'RUNNING',
      behavior === 'allow' ? '已在应用内允许，等待工具结果' : '已在应用内拒绝',
    )
    session.attention = null
    this.emit()
  }

  markAlive(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.alive === true) return
    session.alive = true
    this.emit()
  }

  markProcessUnknown(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session || session.alive === null) return
    session.alive = null
    this.emit()
  }

  markProcessDead(sessionId: string): { changed: boolean; abnormal: boolean } {
    const session = this.sessions.get(sessionId)
    if (!session || session.pid === null) return { changed: false, abnormal: false }

    const wasAlive = session.alive
    session.alive = false

    if (session.status === 'STOPPED') {
      if (session.exitKind === null) {
        session.exitKind = 'normal'
        this.emit()
        return { changed: true, abnormal: false }
      }
      if (wasAlive !== false) this.emit()
      return { changed: wasAlive !== false, abnormal: false }
    }

    session.status = 'STOPPED'
    session.statusReason = '进程已结束，未收到正常退出事件'
    session.exitKind = 'abnormal'
    session.confidence = 'high'
    session.attention = {
      type: 'abnormal-exit',
      since: Date.now(),
      toolName: null,
      reason: 'Claude Code 进程异常退出',
    }
    session.currentTool = null
    this.pushSyntheticEvent(
      session,
      `process-dead:${sessionId}:${Date.now()}`,
      'ProcessDead',
      '进程已退出（异常）',
      'error',
    )
    this.emit()
    return { changed: true, abnormal: true }
  }

  private createSession(event: NormalizedHookEvent): Session {
    return {
      sessionId: event.sessionId,
      pid: null,
      cwd: event.cwd ?? '',
      projectName: projectNameFromCwd(event.cwd ?? ''),
      status: 'UNKNOWN',
      statusReason: '已收到事件，等待可识别的状态',
      confidence: 'medium',
      currentTool: null,
      lastError: null,
      attention: null,
      startedAt: event.receivedAt,
      lastEventAt: 0,
      lastActivityAt: event.receivedAt,
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
    }
  }

  private transition(session: Session, event: NormalizedHookEvent): void {
    switch (event.name) {
      case 'SessionStart':
        setStatus(
          session,
          'WAITING_INPUT',
          event.source === 'resume' ? '会话已恢复，等待输入' : '会话已启动，等待输入',
        )
        session.attention = null
        session.currentTool = null
        session.exitKind = null
        return

      case 'UserPromptSubmit':
        setStatus(session, 'RUNNING', '正在处理请求')
        session.attention = null
        session.currentTool = null
        session.exitKind = null
        return

      case 'PreToolUse':
        setStatus(session, 'RUNNING', event.toolName ? `正在使用 ${event.toolName}` : '正在工作')
        session.currentTool = event.toolName
        session.attention = null
        return

      case 'PostToolUse':
        setStatus(session, 'RUNNING', '工具调用完成')
        session.currentTool = null
        session.attention = null
        return

      case 'PostToolUseFailure':
        setStatus(session, 'RUNNING', '工具调用失败，Claude 可能继续处理')
        session.currentTool = null
        session.attention = null
        session.lastError = event.error ?? '未知错误'
        return

      case 'PermissionRequest': {
        session.currentTool = event.toolName
        const auto = this.autoApprovals.get(session.sessionId)
        if (
          auto &&
          auto.toolName === event.toolName &&
          Math.abs(event.receivedAt - auto.at) <= 15_000
        ) {
          this.autoApprovals.delete(session.sessionId)
          setStatus(session, 'RUNNING', '已自动允许，等待工具结果')
          session.attention = null
          this.pushSyntheticEvent(
            session,
            `auto-approve:${session.sessionId}:${event.eventId}`,
            'AutoApprove',
            `已自动允许 ${event.toolName ?? '工具'}`,
            'warning',
          )
          return
        }
        if (event.toolName === 'AskUserQuestion') {
          setStatus(session, 'WAITING_INPUT', '等待你在原终端回答问题')
          session.attention = buildAttention(event)
          return
        }
        setStatus(
          session,
          'WAITING_PERMISSION',
          event.toolName ? `等待授权：${event.toolName}` : '等待权限确认',
        )
        session.attention = buildAttention(event)
        return
      }

      case 'Notification':
        if (event.notificationType === 'permission_prompt') {
          const alreadyWaiting =
            session.attention?.type === 'permission' || session.attention?.type === 'question'
          if (
            alreadyWaiting &&
            event.receivedAt - (session.attention?.since ?? 0) < NOTIFICATION_DEDUPE_MS
          ) {
            return
          }
          setStatus(session, 'WAITING_PERMISSION', '等待授权（来自通知）')
          session.attention = buildAttention(event)
          return
        }
        if (event.notificationType === 'idle_prompt' && session.status === 'RUNNING') {
          setStatus(session, 'WAITING_INPUT', 'Claude 已空闲 60 秒，等待你处理')
          session.attention = buildAttention(event)
        }
        return

      case 'Stop':
        setStatus(session, 'COMPLETED', '回合完成，等待下一次输入')
        session.attention = null
        session.currentTool = null
        session.lastAssistantMessage = event.lastAssistantMessage
        return

      case 'StopFailure':
        setStatus(session, 'FAILED', 'Claude Code 报告执行失败')
        session.attention = buildAttention(event)
        session.currentTool = null
        session.lastError = event.error ?? '未知错误'
        return

      case 'SessionEnd':
        setStatus(
          session,
          'STOPPED',
          event.reason ? `会话已结束（${event.reason}）` : '会话已结束',
        )
        session.attention = null
        session.currentTool = null
        session.exitKind = 'normal'
        return

      default:
        return
    }
  }

  private pushSyntheticEvent(
    session: Session,
    id: string,
    name: string,
    summary: string,
    severity: EventSeverity,
  ): void {
    if (this.seenEventIds.has(id)) return
    this.markSeen(id)
    session.recentEvents.push({
      id,
      at: Date.now(),
      name,
      summary,
      toolName: null,
      severity,
    })
    session.recentEvents.sort((a, b) => b.at - a.at)
    if (session.recentEvents.length > MAX_RECENT_EVENTS) {
      session.recentEvents.length = MAX_RECENT_EVENTS
    }
  }

  private addTimelineEvent(session: Session, event: NormalizedHookEvent): void {
    const { summary, severity } = summarize(event)
    const view: SessionEventView = {
      id: event.eventId,
      at: event.receivedAt,
      name: event.name,
      summary,
      toolName: event.toolName,
      severity,
    }
    session.recentEvents.push(view)
    session.recentEvents.sort((a, b) => b.at - a.at)
    if (session.recentEvents.length > MAX_RECENT_EVENTS) {
      session.recentEvents.length = MAX_RECENT_EVENTS
    }
  }

  private markSeen(eventId: string): void {
    this.seenEventIds.add(eventId)
    this.seenEventOrder.push(eventId)
    if (this.seenEventOrder.length > MAX_SEEN_EVENT_IDS) {
      const oldest = this.seenEventOrder.shift()
      if (oldest) this.seenEventIds.delete(oldest)
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}
