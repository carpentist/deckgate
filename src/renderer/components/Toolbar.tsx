import { RefreshCw, Search, X } from 'lucide-react'
import type { JSX } from 'react'
import { useWatcherCommands } from '@renderer/hooks/useWatcherCommands'
import { cn } from '@renderer/lib/utils'
import { useWatcherStore, type SortMode } from '@renderer/stores/watcher'
import { Button } from './ui/button'
import { Input } from './ui/input'

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'activity', label: '最近活动' },
  { value: 'started', label: '启动时间' },
  { value: 'status', label: '状态优先' },
]

export function Toolbar(): JSX.Element {
  const query = useWatcherStore((state) => state.query)
  const sort = useWatcherStore((state) => state.sort)
  const setQuery = useWatcherStore((state) => state.setQuery)
  const setSort = useWatcherStore((state) => state.setSort)
  const { busy, refresh } = useWatcherCommands()

  return (
    <div className="flex shrink-0 items-center gap-1.5 px-3 py-2">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-zinc-500" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索项目、会话 ID…"
          className="h-8 pr-7 pl-7 text-[11px]"
          aria-label="搜索会话"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-500 hover:text-zinc-300"
            title="清除搜索"
          >
            <X className="size-3" />
          </button>
        ) : null}
      </div>

      <select
        value={sort}
        onChange={(event) => setSort(event.target.value as SortMode)}
        className="h-8 rounded-lg border border-zinc-800 bg-zinc-900 px-1.5 text-[10px] text-zinc-300 outline-none focus:border-zinc-600"
        aria-label="排序方式"
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        onClick={() => void refresh()}
        disabled={busy !== null}
        title="刷新"
      >
        <RefreshCw className={cn('size-3.5', busy === 'refresh' && 'animate-spin')} />
      </Button>
    </div>
  )
}
