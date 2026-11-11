import { spawnSync } from 'node:child_process'
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const relayPath = resolve(process.cwd(), 'resources/hooks/hook-relay.cjs')

let root: string
let spoolDir: string

function runRelay(input: string) {
  return spawnSync(process.execPath, [relayPath, '--ccw-hook-relay', 'SessionStart'], {
    input,
    env: { ...process.env, LOCALAPPDATA: root },
    encoding: 'utf8',
    timeout: 10_000,
  })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccw-relay-'))
  spoolDir = join(root, 'Deckgate', 'spool')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('hook relay', () => {
  it('writes a complete spool envelope and exits silently', async () => {
    const payload = {
      session_id: 'session-1',
      hook_event_name: 'SessionStart',
      cwd: 'C:\\work\\project',
      source: 'startup',
    }

    const result = runRelay(JSON.stringify(payload))
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')

    const files = await readdir(spoolDir)
    expect(files).toHaveLength(1)
    const name = files[0]
    expect(name?.endsWith('.json')).toBe(true)

    const envelope = JSON.parse(await readFile(join(spoolDir, name!), 'utf8')) as {
      receivedAt: number
      relayVersion: string
      eventId: string
      payload: Record<string, unknown>
    }
    expect(envelope.receivedAt).toBeGreaterThan(0)
    expect(envelope.relayVersion).toBe('0.1.0')
    expect(envelope.eventId).toMatch(/^[0-9a-f-]{36}$/)
    expect(envelope.payload.session_id).toBe('session-1')
  })

  it('does not write anything for malformed input', async () => {
    expect(runRelay('{ bad json').status).toBe(0)
    await expect(access(spoolDir)).rejects.toThrow()

    expect(runRelay(JSON.stringify({ hook_event_name: 'Stop' })).status).toBe(0)
    await expect(readdir(spoolDir)).rejects.toThrow()
  })
})
