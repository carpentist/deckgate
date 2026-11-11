import { Activity, ShieldAlert } from 'lucide-react'
import type { JSX } from 'react'
import { ApprovalSheet } from '@renderer/components/ApprovalSheet'
import { Button } from '@renderer/components/ui/button'
import { MiniBar } from '@renderer/components/MiniBar'
import { SessionDetail } from '@renderer/components/SessionDetail'
import { SettingsView } from '@renderer/components/SettingsView'
import { useFocusSession } from '@renderer/hooks/useFocusSession'
import { useSoundEffects } from '@renderer/hooks/useSoundEffects'
import { useWatcherBridge } from '@renderer/hooks/useWatcherBridge'
import { SessionsPage } from '@renderer/pages/SessionsPage'
import { useWatcherStore } from '@renderer/stores/watcher'

function LoadingView(): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center bg-zinc-950">
      <div className="flex flex-col items-center gap-2 text-zinc-500">
        <Activity className="size-5 animate-pulse text-emerald-400" />
        <p className="text-[11px]">正在连接主进程…</p>
      </div>
    </div>
  )
}

function ConnectionErrorView({ message }: { message: string }): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center bg-zinc-950 p-5">
      <div className="w-full rounded-xl border border-rose-500/25 bg-rose-500/[0.04] p-4 text-center">
        <ShieldAlert className="mx-auto size-5 text-rose-300" />
        <p className="mt-2 text-[12px] font-medium text-zinc-200">无法连接主进程</p>
        <p className="mt-1 break-words text-[10px] leading-relaxed text-zinc-500">{message}</p>
        <Button
          className="mt-3"
          size="sm"
          variant="outline"
          onClick={() => window.location.reload()}
        >
          重新加载
        </Button>
      </div>
    </div>
  )
}

export default function App(): JSX.Element {
  const { connectionError } = useWatcherBridge()
  useSoundEffects()
  useFocusSession()

  const snapshot = useWatcherStore((state) => state.snapshot)
  const view = useWatcherStore((state) => state.view)
  const selectedSession = useWatcherStore(
    (state) =>
      state.snapshot?.sessions.find((session) => session.sessionId === state.selectedSessionId) ??
      null,
  )

  if (connectionError) return <ConnectionErrorView message={connectionError} />
  if (!snapshot) return <LoadingView />

  if (snapshot.settings.miniMode) {
    return (
      <div className="h-full">
        <MiniBar />
      </div>
    )
  }

  let content: JSX.Element
  if (view === 'settings') {
    content = <SettingsView />
  } else if (view === 'detail' && selectedSession) {
    content = <SessionDetail session={selectedSession} />
  } else {
    content = <SessionsPage />
  }

  return (
    <div className="relative h-full bg-zinc-950">
      {content}
      <ApprovalSheet approvals={snapshot.approvals} />
    </div>
  )
}
