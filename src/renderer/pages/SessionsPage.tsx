import { useMemo, type JSX } from 'react'
import type { Session } from '@shared/types/session'
import { isWaitingStatus, STATUS_SORT_ORDER } from '@renderer/lib/status'
import { cn } from '@renderer/lib/utils'
import { useNow } from '@renderer/hooks/useNow'
import {
  useWatcherStore,
  type SessionFilter,
  type SortMode,
} from '@renderer/stores/watcher'
import { EmptyState } from '@renderer/components/EmptyState'
import { Header } from '@renderer/components/Header'
import { SessionRow } from '@renderer/components/SessionRow'
import { StatsBar } from '@renderer/components/StatsBar'
import { Toolbar } from '@renderer/components/Toolbar'

const EMPTY_SESSIONS: Session[] = []

function matchesFilter(session: Session, filter: SessionFilter): boolean {
  switch (filter) {
    case 'running':
      return session.status === 'RUNNING'
    case 'waiting':
      return isWaitingStatus(session.status)
    case 'completed':
      return session.status === 'COMPLETED' || session.status === 'STOPPED'
    case 'error':
      return session.status === 'FAILED' || session.status === 'DISCONNECTED'
    default:
      return true
  }
}

function matchesQuery(session: Session, query: string): boolean {
  if (!query) return true
  const haystack = [
    session.projectName,
    session.cwd,
    session.sessionId,
    session.currentTool ?? '',
    session.lastError ?? '',
    session.statusReason,
  ]
  return haystack.some((value) => value.toLowerCase().includes(query))
}

function sortSessions(sessions: Session[], sort: SortMode): Session[] {
  const sorted = [...sessions]
  if (sort === 'started') {
    sorted.sort((a, b) => b.startedAt - a.startedAt)
    return sorted
  }
  if (sort === 'status') {
    sorted.sort((a, b) => {
      const order = STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status]
      return order !== 0 ? order : b.lastActivityAt - a.lastActivityAt
    })
    return sorted
  }
  sorted.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  return sorted
}

export function SessionsPage(): JSX.Element {
  const snapshot = useWatcherStore((state) => state.snapshot)
  const sessions = snapshot?.sessions ?? EMPTY_SESSIONS
  const query = useWatcherStore((state) => state.query)
  const filter = useWatcherStore((state) => state.filter)
  const sort = useWatcherStore((state) => state.sort)
  const setView = useWatcherStore((state) => state.setView)
  const setQuery = useWatcherStore((state) => state.setQuery)
  const setFilter = useWatcherStore((state) => state.setFilter)
  const now = useNow()

  const visibleSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const filtered = sessions.filter(
      (session) => matchesFilter(session, filter) && matchesQuery(session, normalizedQuery),
    )
    return sortSessions(filtered, sort)
  }, [sessions, filter, query, sort])

  const hookStatus = snapshot?.hookStatus
  const hooksOutdated =
    (hookStatus?.missingEvents?.length ?? 0) > 0 || (hookStatus?.outdated ?? false)
  const autoApproveOn =
    (snapshot?.settings.approvalEnabled ?? false) &&
    (snapshot?.settings.autoApproveAll ?? false)
  const autoProjectCount = snapshot?.settings.autoApproveProjects.length ?? 0
  const autoAllProjects = snapshot?.settings.autoApproveAllProjects ?? false

  function resetFilters(): void {
    setQuery('')
    setFilter('all')
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header />
      <StatsBar />
      <Toolbar />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <EmptyState mode="onboarding" />
        ) : visibleSessions.length === 0 ? (
          <EmptyState mode="filtered" onResetFilters={resetFilters} />
        ) : (
          visibleSessions.map((session) => (
            <SessionRow key={session.sessionId} session={session} now={now} />
          ))
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-between border-t border-zinc-800 px-3 py-1.5 text-[10px]">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setView('settings')}
            className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300"
            title={hookStatus?.error ?? '打开设置'}
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                hookStatus?.installed && !hooksOutdated ? 'bg-emerald-400' : 'bg-amber-400',
              )}
            />
            {hookStatus?.installed
              ? hooksOutdated
                ? 'Hooks 需更新'
                : 'Hooks 已安装'
              : 'Hooks 未安装'}
            {hookStatus?.gateInstalled ? ' · 快速授权可用' : ''}
          </button>
          {autoApproveOn ? (
            <span
              className={cn(
                'shrink-0 rounded-full border px-1.5 py-0.5',
                autoAllProjects || autoProjectCount > 0
                  ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
              )}
            >
              {autoAllProjects
                ? '自动授权 所有项目'
                : autoProjectCount > 0
                  ? `自动授权 ${autoProjectCount} 项目`
                  : '自动授权未选项目'}
            </span>
          ) : null}
        </div>
        <span className="shrink-0 tabular-nums text-zinc-600">{sessions.length} 个会话</span>
      </footer>
    </div>
  )
}
