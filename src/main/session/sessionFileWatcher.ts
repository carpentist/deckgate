import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parseSessionFile, type ClaudeSessionFile } from '../process/sessionFiles'

const MAX_FILE_BYTES = 128 * 1024
const MAX_FILES = 200
const DEFAULT_INTERVAL_MS = 1500

export class SessionFileWatcher {
  private timer: NodeJS.Timeout | null = null
  private stopped = false
  private scanning = false
  private lastSignature = ''
  private lastErrorAt = 0

  constructor(
    private readonly directory: string,
    private readonly onFiles: (files: ClaudeSessionFile[]) => void,
    private readonly onError?: (message: string) => void,
    private readonly intervalMs = DEFAULT_INTERVAL_MS,
  ) {}

  start(): void {
    this.stopped = false
    void this.scan().finally(() => this.schedule())
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  refresh(): void {
    this.lastSignature = ''
    void this.scan()
  }

  private schedule(): void {
    if (this.stopped) return
    this.timer = setTimeout(() => {
      void this.scan().finally(() => this.schedule())
    }, Math.max(500, this.intervalMs))
  }

  private async scan(): Promise<void> {
    if (this.scanning || this.stopped) return
    this.scanning = true
    try {
      const entries = await fs.readdir(this.directory, { withFileTypes: true })
      const names = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name)
        .slice(0, MAX_FILES)

      const files: ClaudeSessionFile[] = []
      for (const name of names) {
        try {
          const path = join(this.directory, name)
          const stat = await fs.stat(path)
          if (stat.size > MAX_FILE_BYTES) continue
          const parsed = parseSessionFile(JSON.parse(await fs.readFile(path, 'utf8')) as unknown)
          if (parsed) files.push(parsed)
        } catch {
          // a file may be replaced while reading
        }
      }

      files.sort((a, b) => a.startedAt - b.startedAt)
      const signature = JSON.stringify(
        files.map((file) => [
          file.sessionId,
          file.pid,
          file.cwd,
          file.startedAt,
          file.status,
          file.waitingFor,
          file.updatedAt,
        ]),
      )
      if (signature !== this.lastSignature) {
        this.lastSignature = signature
        this.onFiles(files)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      const now = Date.now()
      if (now - this.lastErrorAt > 10_000) {
        this.lastErrorAt = now
        this.onError?.(`session-file-read-failed: ${String(error)}`)
      }
    } finally {
      this.scanning = false
    }
  }
}
