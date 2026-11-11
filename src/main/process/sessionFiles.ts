export interface ClaudeSessionFile {
  pid: number
  sessionId: string
  cwd: string
  startedAt: number
  updatedAt: number | null
  status: string | null
  waitingFor: string | null
  procStart: string | null
  version: string | null
  kind: string | null
  entrypoint: string | null
}

export interface ClaudeSessionFileWatcherOptions {
  onFiles: (files: ClaudeSessionFile[]) => void
  onError?: (message: string) => void
  intervalMs?: number
  directory: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clean(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  let out = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 32 || code === 127) continue
    out += char
  }
  const trimmed = out.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

export function parseSessionFile(input: unknown): ClaudeSessionFile | null {
  if (!isRecord(input)) return null
  const pid = input['pid']
  const sessionId = clean(input['sessionId'], 200)
  const cwd = clean(input['cwd'], 1024)
  const startedAt = input['startedAt']
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null
  if (!sessionId || !cwd) return null
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt) || startedAt <= 0) {
    return null
  }

  const updatedAt = input['updatedAt']
  const procStart = input['procStart']
  return {
    pid,
    sessionId,
    cwd,
    startedAt,
    updatedAt:
      typeof updatedAt === 'number' && Number.isFinite(updatedAt) && updatedAt > 0
        ? updatedAt
        : null,
    status: clean(input['status'], 50),
    waitingFor: clean(input['waitingFor'], 200),
    procStart: typeof procStart === 'string' ? clean(procStart, 50) : null,
    version: clean(input['version'], 50),
    kind: clean(input['kind'], 50),
    entrypoint: clean(input['entrypoint'], 50),
  }
}
