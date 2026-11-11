import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { normalizeSettings } from '@shared/schemas/settings'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@shared/types/settings'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class SettingsStore {
  private current: AppSettings = { ...DEFAULT_APP_SETTINGS }

  constructor(private readonly filePath: string) {}

  get(): AppSettings {
    return { ...this.current }
  }

  async load(): Promise<AppSettings> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      this.current = normalizeSettings(JSON.parse(raw) as unknown)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[settings] load failed, using defaults')
      }
      this.current = { ...DEFAULT_APP_SETTINGS }
    }
    return this.get()
  }

  async update(patch: unknown): Promise<AppSettings> {
    const merged = isRecord(patch) ? { ...this.current, ...patch } : this.current
    this.current = normalizeSettings(merged)
    await fs.mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await fs.writeFile(tempPath, `${JSON.stringify(this.current, null, 2)}\n`, 'utf8')
    await fs.rename(tempPath, this.filePath)
    return this.get()
  }
}
