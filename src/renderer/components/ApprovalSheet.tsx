import { KeyRound } from 'lucide-react'
import { useState, type JSX } from 'react'
import type { ApprovalRequestView } from '@shared/types/settings'
import { formatDuration } from '@renderer/lib/format'
import { useNow } from '@renderer/hooks/useNow'
import { Button } from './ui/button'

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+':\s*/, '')
}

export function ApprovalSheet({
  approvals,
}: {
  approvals: ApprovalRequestView[]
}): JSX.Element | null {
  const now = useNow(1000)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (approvals.length === 0) return null
  const current = approvals[0]
  if (!current) return null
  const requestId = current.requestId
  const remaining = Math.max(0, Math.ceil((current.expiresAt - now) / 1000))

  async function decide(behavior: 'allow' | 'deny' | 'fallback'): Promise<void> {
    setBusy(behavior)
    setError(null)
    try {
      const api = window.watcher
      if (!api) throw new Error('主进程未连接')
      await api.approvalDecision(requestId, behavior)
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm">
      <div className="w-full overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl">
        <div className="drag-region flex items-center justify-between border-b border-zinc-800 px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] font-medium text-amber-300">
            <KeyRound className="size-4" />
            快速授权
          </div>
          <span className="text-[10px] tabular-nums text-zinc-500">
            {formatDuration(remaining * 1000)}后回退原终端
          </span>
        </div>

        <div className="space-y-2 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[11px] text-zinc-200">{current.projectName}</p>
              <p className="truncate text-[9px] text-zinc-500">{current.cwd}</p>
            </div>
            <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
              {current.toolName}
            </span>
          </div>

          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-zinc-800 bg-zinc-900/60 p-2 text-[10px] leading-relaxed text-zinc-300">
            {current.inputPreview}
          </pre>

          {current.autoApproveBlockedReason ? (
            <p className="rounded-md border border-amber-500/25 bg-amber-500/[0.05] px-2 py-1 text-[9px] leading-relaxed text-amber-200/90">
              未自动授权：{current.autoApproveBlockedReason}
            </p>
          ) : null}

          <p className="text-[9px] leading-relaxed text-zinc-600">
            仅本次授权，不会记住规则。超时、关闭应用或选择“回原终端”都会回退到终端提示。
          </p>

          {error ? <p className="text-[10px] text-rose-300">{error}</p> : null}

          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="flex-1"
              onClick={() => void decide('fallback')}
              disabled={busy !== null}
            >
              回原终端
            </Button>
            <Button
              size="sm"
              variant="danger"
              className="flex-1"
              onClick={() => void decide('deny')}
              disabled={busy !== null}
            >
              拒绝
            </Button>
            <Button
              size="sm"
              className="flex-1"
              onClick={() => void decide('allow')}
              disabled={busy !== null}
            >
              允许
            </Button>
          </div>

          {approvals.length > 1 ? (
            <p className="text-[9px] text-zinc-500">还有 {approvals.length - 1} 个待处理请求</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
