import {
  Activity,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Pin,
  PinOff,
  X,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type WheelEvent,
} from 'react'
import type { ApprovalRequestView } from '@shared/types/settings'
import type { Session } from '@shared/types/session'
import { formatRelative } from '@renderer/lib/format'
import { STATUS_META } from '@renderer/lib/status'
import { cn } from '@renderer/lib/utils'
import { useNow } from '@renderer/hooks/useNow'
import { useWatcherCommands } from '@renderer/hooks/useWatcherCommands'
import { useWatcherStore } from '@renderer/stores/watcher'
import { Button } from './ui/button'

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+':\s*/, '')
}

function countdownFor(approval: ApprovalRequestView, now: number): string {
  const seconds = Math.max(0, Math.ceil((approval.expiresAt - now) / 1000))
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    : `${seconds}s`
}

export function MiniBar(): JSX.Element {
  const snapshot = useWatcherStore((state) => state.snapshot)
  const openSession = useWatcherStore((state) => state.openSession)
  const setView = useWatcherStore((state) => state.setView)
  const { updateSettings, hideWindow } = useWatcherCommands()
  const now = useNow(1000)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<{
    session: Session
    direction: 'next' | 'prev'
  } | null>(null)
  const wheelLock = useRef(0)
  const leaveTimer = useRef<number | null>(null)

  const sessions = snapshot?.sessions ?? []
  const settings = snapshot?.settings
  const approvals = snapshot?.approvals ?? []
  const approvalSessionIds = new Set(approvals.map((approval) => approval.sessionId))
  const activeStatuses = new Set(['RUNNING', 'WAITING_PERMISSION', 'WAITING_INPUT', 'UNKNOWN'])
  const cards = sessions
    .filter(
      (session) =>
        activeStatuses.has(session.status) || approvalSessionIds.has(session.sessionId),
    )
    .sort((a, b) => {
      const attentionOrder = (a.attention ? 0 : 1) - (b.attention ? 0 : 1)
      return attentionOrder !== 0 ? attentionOrder : b.lastActivityAt - a.lastActivityAt
    })
  const cardSignature = cards.map((session) => session.sessionId).join('|')
  const firstApprovalSessionId = approvals[0]?.sessionId ?? null

  useEffect(() => {
    if (firstApprovalSessionId) {
      setSelectedId(firstApprovalSessionId)
      return
    }
    if (cards.length === 0) {
      setSelectedId(null)
      return
    }
    setSelectedId((current) =>
      current && cards.some((session) => session.sessionId === current)
        ? current
        : (cards[0]?.sessionId ?? null),
    )
  }, [firstApprovalSessionId, cardSignature])

  const selected = cards.find((session) => session.sessionId === selectedId) ?? cards[0] ?? null
  const selectedIndex = selected
    ? cards.findIndex((session) => session.sessionId === selected.sessionId)
    : -1
  const cardApproval = selected
    ? (approvals.find((approval) => approval.sessionId === selected.sessionId) ?? null)
    : null

  useEffect(() => {
    setError(null)
  }, [cardApproval?.requestId, selected?.sessionId])

  useEffect(() => {
    return () => {
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current)
    }
  }, [])

  function cycle(direction: number): void {
    if (cards.length < 2 || !selected || leaving) return
    const currentIndex = cards.findIndex((session) => session.sessionId === selected.sessionId)
    const next = cards[(currentIndex + direction + cards.length) % cards.length]
    if (!next) return

    const nextDirection = direction > 0 ? 'next' : 'prev'
    setLeaving({ session: selected, direction: nextDirection })
    setSelectedId(next.sessionId)
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current)
    leaveTimer.current = window.setTimeout(() => {
      setLeaving(null)
      leaveTimer.current = null
    }, 430)
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>): void {
    if (cards.length < 2) return
    const delta =
      Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
    if (!delta) return
    const nowMs = Date.now()
    if (nowMs - wheelLock.current < 120) return
    wheelLock.current = nowMs
    cycle(delta > 0 ? 1 : -1)
  }

  async function expand(): Promise<void> {
    setView('list')
    try {
      await updateSettings({ miniMode: false })
    } catch (cause) {
      setError(describeError(cause))
    }
  }

  async function openSessionAndExpand(sessionId: string): Promise<void> {
    openSession(sessionId)
    try {
      await updateSettings({ miniMode: false })
    } catch (cause) {
      setError(describeError(cause))
    }
  }

  async function decide(behavior: 'allow' | 'deny' | 'fallback'): Promise<void> {
    if (!cardApproval) return
    const api = window.watcher
    if (!api) {
      setError('主进程未连接')
      return
    }
    setBusy(behavior)
    setError(null)
    try {
      await api.approvalDecision(cardApproval.requestId, behavior)
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setBusy(null)
    }
  }

  const selectedMeta = selected ? STATUS_META[selected.status] : null
  const enterClass = leaving
    ? leaving.direction === 'next'
      ? 'mini-card-enter-next'
      : 'mini-card-enter-prev'
    : ''
  const leavingMeta = leaving ? STATUS_META[leaving.session.status] : null
  const deckShift = leaving
    ? leaving.direction === 'next'
      ? 'mini-deck-shift-next'
      : 'mini-deck-shift-prev'
    : ''

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      {cards.length > 2 ? (
        <div
          className={cn(
            'pointer-events-none absolute bottom-[50px] left-[20px] right-[50px] top-[20px] translate-x-[20px] translate-y-[16px] rotate-[8deg] rounded-xl bg-zinc-600 ring-1 ring-black/40',
            deckShift,
          )}
        />
      ) : null}
      {cards.length > 1 ? (
        <div
          className={cn(
            'pointer-events-none absolute bottom-[50px] left-[20px] right-[50px] top-[20px] translate-x-[10px] translate-y-[8px] rotate-[4deg] rounded-xl bg-zinc-700 ring-1 ring-black/40',
            deckShift,
          )}
        />
      ) : null}

      {leaving && leavingMeta ? (
        <div
          className={cn(
            'pointer-events-none absolute bottom-[50px] left-[20px] right-[50px] top-[20px] z-[5] flex flex-col rounded-xl bg-gradient-to-br from-zinc-900 to-zinc-950 p-2 ring-1 ring-white/10',
            leaving.direction === 'next'
              ? 'mini-card-leave-next'
              : 'mini-card-leave-prev',
          )}
        >
          <div className="flex items-center gap-1.5">
            <span className={cn('size-1.5 shrink-0 rounded-full', leavingMeta.dot)} />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-100">
              {leaving.session.projectName}
            </span>
            <span className={cn('shrink-0 text-[9px]', leavingMeta.text)}>
              {leavingMeta.label}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-1 text-[9px] text-zinc-500">
            {leaving.session.statusReason}
          </p>
        </div>
      ) : null}

      <div
        key={selected?.sessionId ?? 'empty'}
        className={cn(
          'absolute bottom-[50px] left-[20px] right-[50px] top-[20px] z-10 flex min-h-0 flex-col rounded-xl bg-gradient-to-br from-zinc-900 to-zinc-950 p-2 ring-1 ring-white/10 shadow-[0_10px_24px_rgba(0,0,0,0.3)]',
          enterClass,
          !selected && 'drag-region',
        )}
        onWheel={handleWheel}
        onDoubleClick={() => {
          if (selected) void openSessionAndExpand(selected.sessionId)
        }}
        title={cards.length > 1 ? '在卡片内滚动鼠标滚轮切换任务；双击打开详情' : '双击打开详情'}
      >
          {selected && selectedMeta ? (
            <>
              <div className="drag-region flex items-center gap-1.5">
                <span className={cn('size-1.5 shrink-0 rounded-full', selectedMeta.dot)} />
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-100">
                  {selected.projectName}
                </span>
                <span className={cn('shrink-0 text-[9px]', selectedMeta.text)}>
                  {selectedMeta.label}
                </span>
                <span className="shrink-0 text-[8px] tabular-nums text-zinc-600">
                  {selectedIndex + 1}/{cards.length}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-5 shrink-0"
                  onClick={() => void updateSettings({ alwaysOnTop: !(settings?.alwaysOnTop ?? false) })}
                  title={settings?.alwaysOnTop ? '取消置顶' : '窗口置顶'}
                >
                  {settings?.alwaysOnTop ? (
                    <PinOff className="size-2.5" />
                  ) : (
                    <Pin className="size-2.5" />
                  )}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-5 shrink-0"
                  onClick={() => void expand()}
                  title="展开完整窗口"
                >
                  <Maximize2 className="size-2.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-5 shrink-0"
                  onClick={() => void hideWindow()}
                  title="隐藏到托盘"
                >
                  <X className="size-2.5" />
                </Button>
              </div>

              <p
                className="mt-0.5 line-clamp-1 text-[9px] text-zinc-500"
                title={selected.statusReason}
              >
                {selected.statusReason}
              </p>

              {cardApproval ? (
                <div className="mt-1 rounded-md border border-amber-500/20 bg-amber-500/[0.06] p-1.5">
                  <div className="flex items-center gap-1">
                    <span className="min-w-0 truncate text-[9px] font-medium text-amber-200">
                      {cardApproval.toolName}
                    </span>
                    <span className="ml-auto shrink-0 text-[9px] tabular-nums text-zinc-500">
                      {countdownFor(cardApproval, now)}
                    </span>
                  </div>
                  <p
                    className="mt-0.5 line-clamp-1 break-all text-[9px] text-zinc-400"
                    title={cardApproval.inputPreview}
                  >
                    {cardApproval.inputPreview}
                  </p>
                  {cardApproval.autoApproveBlockedReason ? (
                    <p
                      className="line-clamp-1 text-[8px] text-amber-300/80"
                      title={cardApproval.autoApproveBlockedReason}
                    >
                      未自动授权：{cardApproval.autoApproveBlockedReason}
                    </p>
                  ) : null}
                  <div className="mt-1 flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 flex-1 px-1 text-[9px]"
                      onClick={() => void decide('fallback')}
                      disabled={busy !== null}
                    >
                      原终端
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      className="h-6 flex-1 px-1 text-[9px]"
                      onClick={() => void decide('deny')}
                      disabled={busy !== null}
                    >
                      拒绝
                    </Button>
                    <Button
                      size="sm"
                      className="h-6 flex-1 px-1 text-[9px]"
                      onClick={() => void decide('allow')}
                      disabled={busy !== null}
                    >
                      允许
                    </Button>
                  </div>
                  {error ? (
                    <p className="mt-0.5 break-words text-[8px] text-rose-300">{error}</p>
                  ) : null}
                </div>
              ) : (
                <div className="mt-1 min-h-0 flex-1 overflow-hidden">
                  {selected.recentEvents.length > 0 ? (
                    <div className="space-y-[3px]">
                      {selected.recentEvents.slice(0, 6).map((event) => (
                        <div key={event.id} className="flex items-baseline gap-1">
                          <span
                            className={cn(
                              'size-1 shrink-0 rounded-full',
                              event.severity === 'error'
                                ? 'bg-rose-400'
                                : event.severity === 'warning'
                                  ? 'bg-amber-400'
                                  : 'bg-zinc-700',
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate text-[8px] text-zinc-500">
                            {event.summary}
                          </span>
                          <span className="shrink-0 text-[8px] text-zinc-700">
                            {formatRelative(event.at, now)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[9px] text-zinc-600">暂无事件</p>
                  )}
                  {error ? (
                    <p className="mt-1 break-words text-[8px] text-rose-300">{error}</p>
                  ) : null}
                </div>
              )}

              <div className="mt-auto flex items-center justify-between gap-1.5 border-t border-zinc-800/60 pt-1 text-[8px] text-zinc-600">
                <span className="min-w-0 truncate">
                  {selected.sessionId.slice(0, 8)} · {formatRelative(selected.lastActivityAt, now)}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  {approvals.length > 0 && !cardApproval ? (
                    <span className="text-amber-300/80">另 {approvals.length} 个授权</span>
                  ) : null}
                  {cards.length > 1 ? (
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => cycle(-1)}
                        className="rounded p-0.5 text-zinc-500 hover:text-zinc-300"
                        title="上一个任务"
                      >
                        <ChevronUp className="size-3" />
                      </button>
                      <span className="text-[8px] text-zinc-500">滚轮</span>
                      <button
                        type="button"
                        onClick={() => cycle(1)}
                        className="rounded p-0.5 text-zinc-500 hover:text-zinc-300"
                        title="下一个任务"
                      >
                        <ChevronDown className="size-3" />
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1.5 text-center">
              <Activity className="size-4 text-zinc-600" />
              <p className="text-[10px] text-zinc-500">没有活跃会话</p>
              <Button size="sm" variant="outline" onClick={() => void expand()}>
                打开完整窗口
              </Button>
            </div>
          )}
      </div>
    </div>
  )
}
