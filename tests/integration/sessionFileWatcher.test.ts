import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ClaudeSessionFile } from '../../src/main/process/sessionFiles'
import { SessionFileWatcher } from '../../src/main/session/sessionFileWatcher'

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

describe('SessionFileWatcher', () => {
  it('reads live session metadata and notices status changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ccw-session-files-'))
    const directory = join(root, 'sessions')
    await mkdir(directory, { recursive: true })

    const sessionFile = join(directory, '123.json')
    const payload = {
      pid: 123,
      sessionId: 'session-1',
      cwd: 'C:\\work\\project',
      startedAt: 1000,
      status: 'busy',
      updatedAt: 2000,
    }
    await writeFile(sessionFile, JSON.stringify(payload), 'utf8')

    const snapshots: ClaudeSessionFile[][] = []
    const watcher = new SessionFileWatcher(
      directory,
      (files) => snapshots.push(files),
      undefined,
      400,
    )

    try {
      watcher.start()
      await waitFor(() => snapshots.length > 0)
      expect(snapshots[0]?.[0]).toMatchObject({
        pid: 123,
        sessionId: 'session-1',
        status: 'busy',
      })

      await writeFile(
        sessionFile,
        JSON.stringify({ ...payload, status: 'waiting', waitingFor: 'approve Bash', updatedAt: 3000 }),
        'utf8',
      )
      await waitFor(() => snapshots.some((files) => files[0]?.status === 'waiting'))
      const waiting = snapshots.find((files) => files[0]?.status === 'waiting')
      expect(waiting?.[0]?.waitingFor).toBe('approve Bash')
    } finally {
      watcher.stop()
      await rm(root, { recursive: true, force: true })
    }
  })
})
