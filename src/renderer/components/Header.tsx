import { Activity, Minimize2, Pin, PinOff, Settings, X } from 'lucide-react'
import type { JSX } from 'react'
import { useWatcherCommands } from '@renderer/hooks/useWatcherCommands'
import { useWatcherStore } from '@renderer/stores/watcher'
import { Button } from './ui/button'

export function Header(): JSX.Element {
  const snapshot = useWatcherStore((state) => state.snapshot)
  const setView = useWatcherStore((state) => state.setView)
  const { busy, error, clearError, updateSettings, hideWindow } = useWatcherCommands()
  const settings = snapshot?.settings
  const sessions = snapshot?.sessions ?? []
  const pending = Math.max(
    sessions.filter(
      (session) =>
        session.attention?.type === 'permission' || session.attention?.type === 'question',
    ).length,
    snapshot?.approvals.length ?? 0,
  )

  return (
    <header className="shrink-0 border-b border-zinc-800 bg-zinc-950/95">
      <div className="drag-region flex h-12 items-center gap-2 px-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/10 text-emerald-400">
          <Activity className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h1 className="truncate text-[12px] font-semibold tracking-wide text-zinc-100">
              Deckgate
            </h1>
            {pending > 0 ? (
              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                {pending} 待处理
              </span>
            ) : null}
          </div>
          <p className="truncate text-[10px] text-zinc-500">本地权限门控 · 数据不出本机</p>
        </div>

        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={() => void updateSettings({ alwaysOnTop: !(settings?.alwaysOnTop ?? false) })}
          title={settings?.alwaysOnTop ? '取消置顶' : '窗口置顶'}
        >
          {settings?.alwaysOnTop ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={() => void updateSettings({ miniMode: true })}
          disabled={busy !== null}
          title="收起为迷你条"
        >
          <Minimize2 className="size-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={() => setView('settings')}
          title="设置"
        >
          <Settings className="size-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          onClick={() => void hideWindow()}
          title="隐藏到系统托盘"
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {error ? (
        <div className="flex items-center justify-between gap-2 border-t border-rose-500/20 bg-rose-500/[0.06] px-3 py-1.5 text-[10px] text-rose-300">
          <span className="truncate" title={error}>
            {error}
          </span>
          <button
            type="button"
            className="shrink-0 text-rose-300/70 hover:text-rose-200"
            onClick={clearError}
          >
            关闭
          </button>
        </div>
      ) : null}
    </header>
  )
}
