import { AlertCircle, ChevronRight } from 'lucide-react'
import type { JSX } from 'react'
import type { Session } from '@shared/types/session'
import { formatDuration, formatRelative, shortSessionId } from '@renderer/lib/format'
import { ATTENTION_META } from '@renderer/lib/status'
import { useWatcherStore } from '@renderer/stores/watcher'
import { Badge } from './ui/badge'
import { StatusBadge } from './StatusBadge'

export function SessionRow({ session, now }: { session: Session; now: number }): JSX.Element {
  const openSession = useWatcherStore((state) => state.openSession)
  const isTerminal =
    session.status === 'COMPLETED' || session.status === 'STOPPED' || session.status === 'FAILED'
  const end = isTerminal ? session.lastActivityAt : now
  const duration = formatDuration(Math.max(0, end - session.startedAt))
  const isWaitingForAttention =
    session.attention !== null &&
    (session.status === 'WAITING_PERMISSION' || session.status === 'WAITING_INPUT')
  const durationLabel = isWaitingForAttention
    ? `已等待 ${formatDuration(Math.max(0, now - session.attention!.since))}`
    : session.status === 'RUNNING'
      ? `已运行 ${duration}`
      : `历时 ${duration}`
  const attentionMeta = session.attention ? ATTENTION_META[session.attention.type] : null

  return (
    <button
      type="button"
      onClick={() => openSession(session.sessionId)}
      className="group flex w-full items-center gap-2 border-b border-zinc-800/60 px-3 py-2.5 text-left transition-colors hover:bg-zinc-900/70"
      title={session.lastError ?? session.cwd}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12px] font-medium text-zinc-100">
            {session.projectName}
          </span>
          <span className="shrink-0 font-mono text-[9px] text-zinc-600">
            {shortSessionId(session.sessionId)}
          </span>
          <StatusBadge status={session.status} />
          <span className="ml-auto shrink-0 text-[10px] tabular-nums text-zinc-600">
            {formatRelative(session.lastActivityAt, now)}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[10px] text-zinc-500">
            {session.statusReason}
          </span>
          {session.attention && attentionMeta ? (
            <Badge className={`${attentionMeta.className} shrink-0`}>{attentionMeta.label}</Badge>
          ) : null}
          {session.lastError && !session.attention ? (
            <span className="shrink-0 text-rose-400/80" title={session.lastError}>
              <AlertCircle className="size-3" />
            </span>
          ) : null}
          <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
            {durationLabel}
          </span>
        </div>
      </div>
      <ChevronRight className="size-3 shrink-0 text-zinc-700 transition-colors group-hover:text-zinc-500" />
    </button>
  )
}
