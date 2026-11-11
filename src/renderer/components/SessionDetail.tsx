import {
  AlertCircle,
  ChevronLeft,
  Copy,
  FolderOpen,
  Hand,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type JSX } from 'react'
import { isProjectAutoApproved, normalizeProjectPath } from '@shared/autoApprove'
import type { Session } from '@shared/types/session'
import { useNow } from '@renderer/hooks/useNow'
import { useWatcherCommands } from '@renderer/hooks/useWatcherCommands'
import { formatDateTime, formatRelative } from '@renderer/lib/format'
import { ATTENTION_META } from '@renderer/lib/status'
import { cn } from '@renderer/lib/utils'
import { useWatcherStore } from '@renderer/stores/watcher'
import { StatusBadge } from './StatusBadge'
import { Button } from './ui/button'
import { Switch } from './ui/switch'

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-2.5 py-2">
      <p className="text-[9px] text-zinc-600">{label}</p>
      <p className={cn('mt-0.5 truncate text-[10px] text-zinc-300', mono && 'font-mono')}>{value}</p>
    </div>
  )
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+':\s*/, '')
}

export function SessionDetail({ session }: { session: Session }): JSX.Element {
  const backToList = useWatcherStore((state) => state.backToList)
  const snapshot = useWatcherStore((state) => state.snapshot)
  const { updateSettings, hideWindow } = useWatcherCommands()
  const settings = snapshot?.settings
  const autoApproveProjects = settings?.autoApproveProjects ?? []
  const projectAutoApproved = isProjectAutoApproved(session.cwd, autoApproveProjects)
  const now = useNow()
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    setFeedback(null)
  }, [session.sessionId])

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  function flash(text: string, error = false): void {
    setFeedback({ text, error })
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setFeedback(null), 2000)
  }

  async function copy(label: string, text: string): Promise<void> {
    try {
      const api = window.watcher
      if (!api) throw new Error('主进程未连接')
      await api.copyText(text)
      flash(`${label}已复制`)
    } catch (error) {
      flash(describeError(error), true)
    }
  }

  async function openFolder(): Promise<void> {
    if (!session.cwd) return
    try {
      const api = window.watcher
      if (!api) throw new Error('主进程未连接')
      await api.openPath(session.cwd)
    } catch (error) {
      flash(describeError(error), true)
    }
  }

  function toggleProjectAutoApproved(checked: boolean): void {
    if (!session.cwd) return
    const key = normalizeProjectPath(session.cwd)
    const next = checked
      ? [...autoApproveProjects.filter((project) => normalizeProjectPath(project) !== key), session.cwd]
      : autoApproveProjects.filter((project) => normalizeProjectPath(project) !== key)
    void updateSettings({ autoApproveProjects: next })
  }

  const attentionMeta = session.attention ? ATTENTION_META[session.attention.type] : null
  const processValue = session.pid
    ? `PID ${session.pid}${session.alive === true ? ' · 存活' : session.alive === false ? ' · 已退出' : ''}`
    : '暂不可用'

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="drag-region flex shrink-0 items-center gap-1.5 border-b border-zinc-800 px-2 py-1.5">
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={backToList}
          title="返回列表"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-medium text-zinc-100">
              {session.projectName}
            </span>
            <StatusBadge status={session.status} />
          </div>
          <p className="truncate text-[10px] text-zinc-500">{session.statusReason}</p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={() => void hideWindow()}
          title="隐藏到托盘"
        >
          <X className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
        {session.attention && attentionMeta ? (
          <div className={cn('rounded-lg border p-2.5', attentionMeta.className)}>
            <div className="flex items-center gap-1.5 text-[11px] font-medium">
              <Hand className="size-3.5" />
              {attentionMeta.label}
            </div>
            <p className="mt-1 text-[10px] leading-relaxed opacity-80">
              {session.attention.reason}
            </p>
            <p className="mt-1.5 text-[9px] leading-relaxed opacity-60">
              请回到启动该会话的终端处理。本应用不会自动批准或拒绝。
            </p>
          </div>
        ) : null}

        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-2.5 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] text-zinc-600">会话 ID</p>
            <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-300">
              {session.sessionId}
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="size-7 shrink-0"
            onClick={() => void copy('会话 ID', session.sessionId)}
            title="复制会话 ID"
          >
            <Copy className="size-3.5" />
          </Button>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] uppercase tracking-wider text-zinc-600">工作目录</span>
            <div className="flex gap-0.5">
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => void copy('目录', session.cwd)}
                disabled={!session.cwd}
                title="复制目录"
              >
                <Copy className="size-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                onClick={() => void openFolder()}
                disabled={!session.cwd}
                title="在资源管理器中打开"
              >
                <FolderOpen className="size-3.5" />
              </Button>
            </div>
          </div>
          <p className="mt-1 break-all font-mono text-[10px] leading-relaxed text-zinc-300">
            {session.cwd || '未知目录'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Info label="进程" value={processValue} mono />
          <Info label="当前工具" value={session.currentTool ?? '—'} />
          <Info label="启动时间" value={formatDateTime(session.startedAt)} />
          <Info label="最近活动" value={formatRelative(session.lastActivityAt, now)} />
        </div>

        <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800/70 bg-zinc-900/30 px-2.5 py-2">
          <div className="min-w-0">
            <p className="text-[10px] text-zinc-300">自动授权此项目</p>
            <p className="mt-0.5 text-[9px] text-zinc-600">
              需开启自动授权总开关；危险工具/命令仍会转为手动卡片
            </p>
          </div>
          <Switch
            checked={projectAutoApproved}
            onCheckedChange={toggleProjectAutoApproved}
            disabled={!settings?.autoApproveAll || !session.cwd}
            label="自动授权此项目"
          />
        </div>

        {session.lastError ? (
          <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.05] p-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-medium text-rose-300">
              <AlertCircle className="size-3.5" />
              最近错误
            </div>
            <p className="mt-1 break-words text-[10px] leading-relaxed text-rose-200/80">
              {session.lastError}
            </p>
          </div>
        ) : null}

        {session.lastAssistantMessage ? (
          <section>
            <h3 className="text-[10px] font-medium text-zinc-400">最近回复</h3>
            <p className="mt-1 line-clamp-5 whitespace-pre-wrap break-words rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-2.5 text-[10px] leading-relaxed text-zinc-400">
              {session.lastAssistantMessage}
            </p>
          </section>
        ) : null}

        <section>
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-medium text-zinc-400">事件时间线</h3>
            <span className="text-[9px] tabular-nums text-zinc-600">
              {session.recentEvents.length}
            </span>
          </div>
          {session.recentEvents.length === 0 ? (
            <p className="mt-1.5 text-[10px] text-zinc-600">暂无事件</p>
          ) : (
            <div className="mt-1.5 space-y-1.5">
              {session.recentEvents.slice(0, 20).map((event) => (
                <div key={event.id} className="flex gap-1.5">
                  <span
                    className={cn(
                      'mt-1 size-1.5 shrink-0 rounded-full',
                      event.severity === 'error'
                        ? 'bg-rose-400'
                        : event.severity === 'warning'
                          ? 'bg-amber-400'
                          : 'bg-zinc-600',
                    )}
                  />
                  <div className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
                    <p className="break-words text-[10px] leading-relaxed text-zinc-300">
                      {event.summary}
                    </p>
                    <span className="shrink-0 font-mono text-[9px] text-zinc-600">
                      {new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <p className="text-[9px] leading-relaxed text-zinc-600">
          状态由 Claude Code Hooks 推断；无法可靠判断时显示“未知”，不会猜测。
        </p>
      </div>

      {feedback ? (
        <div
          className={cn(
            'absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border px-3 py-1 text-[10px] shadow-lg',
            feedback.error
              ? 'border-rose-500/30 bg-rose-950/90 text-rose-200'
              : 'border-emerald-500/30 bg-emerald-950/90 text-emerald-200',
          )}
          aria-live="polite"
        >
          {feedback.text}
        </div>
      ) : null}
    </div>
  )
}
