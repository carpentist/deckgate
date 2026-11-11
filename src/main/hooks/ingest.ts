import { promises as fs, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { NormalizedHookEvent } from '@shared/types/hooks'
import { parseHookEnvelope } from './parser'

const MAX_EVENT_FILE_BYTES = 512 * 1024
const SCAN_INTERVAL_MS = 2_000

export class HookSpoolIngest {
  private watcher: FSWatcher | null = null
  private interval: NodeJS.Timeout | null = null
  private scanning = false
  private pending = false
  private stopped = false

  constructor(
    private readonly spoolDir: string,
    private readonly onEvent: (event: NormalizedHookEvent) => void,
    private readonly onError?: (message: string) => void,
  ) {}

  async start(): Promise<void> {
    await fs.mkdir(this.spoolDir, { recursive: true })
    await this.scan()
    try {
      this.watcher = watch(this.spoolDir, () => this.scheduleScan())
    } catch (error) {
      this.onError?.(`spool-watch-failed: ${String(error)}`)
    }
    this.interval = setInterval(() => this.scheduleScan(), SCAN_INTERVAL_MS)
  }

  stop(): void {
    this.stopped = true
    this.watcher?.close()
    this.watcher = null
    if (this.interval) clearInterval(this.interval)
    this.interval = null
  }

  private scheduleScan(): void {
    if (this.stopped) return
    if (this.scanning) {
      this.pending = true
      return
    }
    void this.runScan()
  }

  private async runScan(): Promise<void> {
    this.scanning = true
    try {
      await this.scan()
    } catch (error) {
      this.onError?.(`spool-scan-failed: ${String(error)}`)
    } finally {
      this.scanning = false
      if (this.pending && !this.stopped) {
        this.pending = false
        this.scheduleScan()
      }
    }
  }

  private async scan(): Promise<void> {
    let entries: string[]
    try {
      entries = await fs.readdir(this.spoolDir)
    } catch (error) {
      this.onError?.(`spool-readdir-failed: ${String(error)}`)
      return
    }

    const files = entries.filter((name) => name.endsWith('.json')).sort()
    for (const name of files) {
      if (this.stopped) return
      const filePath = join(this.spoolDir, name)
      try {
        const stat = await fs.stat(filePath)
        if (stat.size > MAX_EVENT_FILE_BYTES) {
          await fs.unlink(filePath)
          this.onError?.('spool-event-too-large')
          continue
        }
        const raw = await fs.readFile(filePath, 'utf8')
        const parsed = parseHookEnvelope(JSON.parse(raw) as unknown)
        if (parsed.ok) {
          this.onEvent(parsed.event)
        } else {
          this.onError?.(`spool-event-invalid: ${parsed.error}`)
        }
      } catch (error) {
        this.onError?.(`spool-event-failed: ${String(error)}`)
      } finally {
        await fs.unlink(filePath).catch(() => undefined)
      }
    }
  }
}
