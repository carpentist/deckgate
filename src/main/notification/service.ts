import { Notification } from 'electron'
import type { NormalizedHookEvent } from '@shared/types/hooks'
import type { Session } from '@shared/types/session'
import type { AppSettings, SoundKind } from '@shared/types/settings'

export type NotificationKind =
  | 'permission'
  | 'question'
  | 'completed'
  | 'failure'
  | 'abnormal'
  | 'idle'

const LONG_WAIT_MS = 5 * 60_000
const LONG_WAIT_COOLDOWN_MS = 10 * 60_000
const ATTENTION_DEDUPE_MS = 10_000

interface NotificationServiceOptions {
  getSettings: () => AppSettings
  isApprovalAvailable: () => boolean
  showWindow: () => void
  focusSession: (sessionId: string) => void
  playSound: (kind: SoundKind) => void
  onSent?: (record: {
    sessionId: string
    kind: NotificationKind
    title: string
    body: string
    sentAt: number
  }) => void
}

export class NotificationService {
  private readonly lastAlert = new Map<string, number>()
  private readonly longWaitAlerts = new Map<string, number>()

  constructor(private readonly options: NotificationServiceOptions) {}

  handleHookEvent(event: NormalizedHookEvent, session: Session): void {
    const settings = this.options.getSettings()
    if (settings.approvalEnabled && settings.autoApproveAll) {
      if (event.name === 'PermissionRequest' && event.toolName !== 'AskUserQuestion') {
        return
      }
      if (
        event.name === 'Notification' &&
        event.notificationType === 'permission_prompt' &&
        session.attention?.type !== 'question'
      ) {
        return
      }
    }

    switch (event.name) {
      case 'PermissionRequest': {
        const question = event.toolName === 'AskUserQuestion'
        const hint = this.options.isApprovalAvailable()
          ? '可在本应用内点击允许/拒绝。'
          : '请回到原终端处理。'
        this.alert(
          question ? 'question' : 'permission',
          session,
          question ? '需要你的回答' : '需要授权',
          question
            ? `Claude 正在等待你在终端选择或回答。${hint}`
            : `工具 ${event.toolName ?? '未知'} 需要你的批准。${hint}`,
          'attention',
        )
        return
      }

      case 'Notification': {
        if (event.notificationType === 'permission_prompt') {
          const question = session.attention?.type === 'question'
          const hint = this.options.isApprovalAvailable()
            ? '可在本应用内处理。'
            : '请回到原终端处理。'
          this.alert(
            question ? 'question' : 'permission',
            session,
            question ? '需要你的回答' : '需要授权',
            `${session.attention?.reason ?? 'Claude 正在等待你的处理。'}${hint}`,
            'attention',
          )
          return
        }
        if (event.notificationType === 'idle_prompt' && session.attention?.type === 'idle') {
          this.alert(
            'idle',
            session,
            '等待输入',
            'Claude 已空闲 60 秒，可能需要你的下一步输入。',
            'attention',
          )
        }
        return
      }

      case 'Stop':
        this.alert('completed', session, '回合完成', '任务回合已完成，等待下一次输入。', 'success')
        return

      case 'StopFailure':
        this.alert(
          'failure',
          session,
          '执行失败',
          event.error ?? 'Claude Code 报告执行失败。',
          'error',
        )
        return

      default:
        return
    }
  }

  notifyAbnormal(session: Session): void {
    this.alert(
      'abnormal',
      session,
      '会话异常退出',
      'Claude Code 进程已结束，但未收到正常退出事件。',
      'error',
    )
  }

  checkLongWaiting(sessions: Session[]): void {
    const settings = this.options.getSettings()
    if (!settings.notificationsEnabled) return
    const now = Date.now()

    for (const session of sessions) {
      const attention = session.attention
      if (!attention || (attention.type !== 'permission' && attention.type !== 'question')) {
        continue
      }
      if (now - attention.since < LONG_WAIT_MS) continue
      if (!this.isKindEnabled(attention.type === 'question' ? 'question' : 'permission')) continue

      const key = `${session.sessionId}:long:${attention.type}:${attention.since}`
      const last = this.longWaitAlerts.get(key) ?? 0
      if (now - last < LONG_WAIT_COOLDOWN_MS) continue
      this.longWaitAlerts.set(key, now)

      const title = `${session.projectName} 仍在等待处理`
      const body = `已等待超过 5 分钟：${attention.reason}`
      this.showToast(title, body, session.sessionId)
      this.playSound('attention')
      this.options.onSent?.({
        sessionId: session.sessionId,
        kind: attention.type === 'question' ? 'question' : 'permission',
        title,
        body,
        sentAt: now,
      })
    }
  }

  test(): void {
    this.showToast('Deckgate', '通知与声音测试成功。', null)
    this.playSound('attention')
  }

  private alert(
    kind: NotificationKind,
    session: Session,
    titleSuffix: string,
    body: string,
    sound: SoundKind,
  ): void {
    if (!this.isKindEnabled(kind)) return

    const settings = this.options.getSettings()
    const now = Date.now()
    const key = `${session.sessionId}:${kind}`
    const last = this.lastAlert.get(key) ?? 0
    const minimumGap =
      kind === 'permission' || kind === 'question'
        ? Math.max(settings.notificationCooldownSec * 1000, ATTENTION_DEDUPE_MS)
        : settings.notificationCooldownSec * 1000
    if (now - last < minimumGap) return
    this.lastAlert.set(key, now)

    const title = `${session.projectName} ${titleSuffix}`
    this.showToast(title, body, session.sessionId)
    this.playSound(sound)
    this.options.onSent?.({
      sessionId: session.sessionId,
      kind,
      title,
      body,
      sentAt: now,
    })
  }

  private isKindEnabled(kind: NotificationKind): boolean {
    const settings = this.options.getSettings()
    if (!settings.notificationsEnabled) return false
    switch (kind) {
      case 'permission':
        return settings.notifyOnPermission
      case 'question':
      case 'idle':
        return settings.notifyOnQuestion
      case 'completed':
        return settings.notifyOnCompletion
      case 'failure':
        return settings.notifyOnFailure
      case 'abnormal':
        return settings.notifyOnAbnormalExit
      default:
        return false
    }
  }

  private playSound(kind: SoundKind): void {
    if (!this.options.getSettings().soundEnabled) return
    try {
      this.options.playSound(kind)
    } catch {
      // sound must never break monitoring
    }
  }

  private showToast(title: string, body: string, sessionId: string | null): void {
    if (!Notification.isSupported()) return
    try {
      const notification = new Notification({
        title,
        body,
        silent: true,
        timeoutType: 'default',
      })
      if (sessionId) {
        notification.on('click', () => {
          try {
            this.options.showWindow()
            this.options.focusSession(sessionId)
          } catch {
            // ignore focus errors
          }
        })
      }
      notification.show()
    } catch (error) {
      console.warn('[notify] failed', String(error))
    }
  }
}
