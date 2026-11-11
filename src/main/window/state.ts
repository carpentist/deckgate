import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

const DEFAULT_BOUNDS: WindowBounds = { width: 440, height: 700 }
const MIN_WIDTH = 380
const MIN_HEIGHT = 520
const MAX_WIDTH = 1600
const MAX_HEIGHT = 1400

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeBounds(input: unknown): WindowBounds | null {
  if (!isRecord(input)) return null
  const width = input['width']
  const height = input['height']
  const x = input['x']
  const y = input['y']
  if (typeof width !== 'number' || typeof height !== 'number') return null
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width < MIN_WIDTH || width > MAX_WIDTH) return null
  if (height < MIN_HEIGHT || height > MAX_HEIGHT) return null
  const bounds: WindowBounds = { width: Math.round(width), height: Math.round(height) }
  if (typeof x === 'number' && Number.isFinite(x)) bounds.x = Math.round(x)
  if (typeof y === 'number' && Number.isFinite(y)) bounds.y = Math.round(y)
  return bounds
}

export class WindowStateStore {
  private current: WindowBounds = { ...DEFAULT_BOUNDS }

  constructor(private readonly filePath: string) {}

  async load(): Promise<WindowBounds> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const normalized = normalizeBounds(JSON.parse(raw) as unknown)
      if (normalized) this.current = normalized
    } catch {
      this.current = { ...DEFAULT_BOUNDS }
    }
    return this.get()
  }

  get(): WindowBounds {
    return { ...this.current }
  }

  async save(bounds: WindowBounds): Promise<void> {
    const normalized = normalizeBounds(bounds)
    if (!normalized) return
    this.current = normalized
    try {
      await fs.mkdir(dirname(this.filePath), { recursive: true })
      const tempPath = `${this.filePath}.tmp`
      await fs.writeFile(tempPath, `${JSON.stringify(this.current, null, 2)}\n`, 'utf8')
      await fs.rename(tempPath, this.filePath)
    } catch {
      // window state is best effort
    }
  }
}
