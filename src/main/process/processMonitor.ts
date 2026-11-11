import type { Session } from '@shared/types/session'
import { queryProcesses, type ProcessInfo } from './windowsQuery'

export interface ProcessMonitorOptions {
  getSessions: () => Session[]
  getIntervalMs: () => number
  query?: (pids: number[]) => Promise<Map<number, ProcessInfo>>
  onAlive: (sessionId: string) => void
  onDead: (sessionId: string) => void
  onUnknown: (sessionId: string) => void
  onError?: (message: string) => void
}

function isClaudeProcess(info: ProcessInfo): boolean {
  const name = info.name.toLowerCase()
  return name === 'claude' || name === 'claude.exe'
}

export class ProcessMonitor {
  private timer: NodeJS.Timeout | null = null
  private stopped = false
  private running = false

  constructor(private readonly options: ProcessMonitorOptions) {}

  start(): void {
    this.stopped = false
    void this.poll().finally(() => this.schedule())
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(): void {
    if (this.stopped) return
    const interval = Math.min(30_000, Math.max(2_000, this.options.getIntervalMs()))
    this.timer = setTimeout(() => {
      void this.poll().finally(() => this.schedule())
    }, interval)
  }

  private async poll(): Promise<void> {
    if (this.running || this.stopped) return
    this.running = true
    try {
      const sessions = this.options
        .getSessions()
        .filter(
          (session) =>
            session.pid !== null &&
            !(session.status === 'STOPPED' && session.alive === false),
        )
      if (sessions.length === 0) return

      let processes: Map<number, ProcessInfo>
      try {
        const query = this.options.query ?? queryProcesses
        processes = await query(sessions.map((session) => session.pid as number))
      } catch (error) {
        for (const session of sessions) this.options.onUnknown(session.sessionId)
        this.options.onError?.(`process-query-failed: ${String(error)}`)
        return
      }

      for (const session of sessions) {
        const pid = session.pid
        if (pid === null) continue
        const info = processes.get(pid)
        if (!info || !isClaudeProcess(info)) {
          this.options.onDead(session.sessionId)
          continue
        }
        this.options.onAlive(session.sessionId)
      }
    } finally {
      this.running = false
    }
  }
}
