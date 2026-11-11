import type { JSX } from 'react'
import type { Session } from '@shared/types/session'
import { isAbnormalStatus, isWaitingStatus } from '@renderer/lib/status'
import { cn } from '@renderer/lib/utils'
import { useWatcherStore, type SessionFilter } from '@renderer/stores/watcher'

const EMPTY_SESSIONS: Session[] = []

export function StatsBar(): JSX.Element {
  const sessions = useWatcherStore((state) => state.snapshot?.sessions) ?? EMPTY_SESSIONS
  const filter = useWatcherStore((state) => state.filter)
  const setFilter = useWatcherStore((state) => state.setFilter)

  const chips: { value: SessionFilter; label: string; count: number; dot: string; active: string }[] =
    [
      {
        value: 'all',
        label: '全部',
        count: sessions.length,
        dot: 'bg-zinc-500',
        active: 'border-zinc-600 bg-zinc-800/80 text-zinc-100',
      },
      {
        value: 'running',
        label: '运行',
        count: sessions.filter((session) => session.status === 'RUNNING').length,
        dot: 'bg-emerald-400',
        active: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
      },
      {
        value: 'waiting',
        label: '等待',
        count: sessions.filter((session) => isWaitingStatus(session.status)).length,
        dot: 'bg-amber-400',
        active: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
      },
      {
        value: 'error',
        label: '异常',
        count: sessions.filter((session) => isAbnormalStatus(session.status)).length,
        dot: 'bg-rose-400',
        active: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
      },
    ]

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-zinc-800/70 px-3 py-2">
      {chips.map((chip) => (
        <button
          key={chip.value}
          type="button"
          onClick={() => setFilter(chip.value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] transition-colors',
            filter === chip.value
              ? chip.active
              : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
          )}
        >
          <span className={cn('size-1.5 rounded-full', chip.dot)} />
          {chip.label}
          <span className="tabular-nums opacity-70">{chip.count}</span>
        </button>
      ))}
    </div>
  )
}
