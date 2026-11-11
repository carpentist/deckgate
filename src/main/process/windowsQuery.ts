import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface ProcessInfo {
  pid: number
  name: string
  startTimeMs: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseProcessQueryOutput(stdout: string): Map<number, ProcessInfo> {
  const result = new Map<number, ProcessInfo>()
  const trimmed = stdout.trim()
  if (!trimmed) return result

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return result
  }

  const items = Array.isArray(parsed) ? parsed : [parsed]
  for (const item of items) {
    if (!isRecord(item)) continue
    const pid = item['id']
    const name = item['name']
    const start = item['start']
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) continue
    if (typeof name !== 'string' || !name) continue
    result.set(pid, {
      pid,
      name,
      startTimeMs:
        typeof start === 'number' && Number.isFinite(start) && start > 0 ? start : null,
    })
  }
  return result
}

export async function queryProcesses(
  pids: number[],
  timeoutMs = 3000,
): Promise<Map<number, ProcessInfo>> {
  const unique = [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))].slice(0, 64)
  if (unique.length === 0) return new Map()

  const script = [
    `$ErrorActionPreference='SilentlyContinue'; $ids=@(${unique.join(',')});`,
    'Get-Process -Id $ids -ErrorAction SilentlyContinue |',
    'ForEach-Object { [pscustomobject]@{ id=$_.Id; name=$_.ProcessName; start=[int64]([datetimeoffset]$_.StartTime).ToUnixTimeMilliseconds() } } |',
    'ConvertTo-Json -Compress;',
    'exit 0',
  ].join(' ')

  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
  )
  return parseProcessQueryOutput(stdout)
}
