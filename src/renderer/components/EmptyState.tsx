import { Download, Inbox, Search } from 'lucide-react'
import type { JSX } from 'react'
import { useWatcherCommands } from '@renderer/hooks/useWatcherCommands'
import { useWatcherStore } from '@renderer/stores/watcher'
import { Button } from './ui/button'

export function EmptyState({
  mode,
  onResetFilters,
}: {
  mode: 'onboarding' | 'filtered'
  onResetFilters?: () => void
}): JSX.Element {
  const installed = useWatcherStore((state) => state.snapshot?.hookStatus.installed ?? false)
  const { busy, install } = useWatcherCommands()

  if (mode === 'filtered') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
        <div className="flex size-9 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-500">
          <Search className="size-4" />
        </div>
        <p className="text-[11px] font-medium text-zinc-300">没有匹配的会话</p>
        <p className="text-[10px] text-zinc-600">尝试调整搜索词或状态筛选。</p>
        <Button size="sm" variant="outline" onClick={onResetFilters}>
          清除筛选
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className="flex size-10 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-500">
        <Inbox className="size-5" />
      </div>
      <div>
        <p className="text-[11px] font-medium text-zinc-200">还没有会话</p>
        <p className="mx-auto mt-1 max-w-[260px] text-[10px] leading-relaxed text-zinc-500">
          在任意终端启动新的 Claude Code 会话后，状态会自动出现在这里。
        </p>
      </div>

      {installed ? (
        <p className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 font-mono text-[10px] text-zinc-400">
          claude
        </p>
      ) : (
        <Button size="sm" onClick={() => void install()} disabled={busy !== null}>
          <Download className="size-3" />
          {busy === 'install' ? '安装中…' : '安装监控 Hooks'}
        </Button>
      )}

      <p className="max-w-[260px] text-[9px] leading-relaxed text-zinc-600">
        已运行的会话不会被 Hooks 捕获，安装后请重启对应会话。
      </p>
    </div>
  )
}
