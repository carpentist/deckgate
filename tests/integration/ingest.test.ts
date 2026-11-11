import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NormalizedHookEvent } from '@shared/types/hooks'
import { HookSpoolIngest } from '../../src/main/hooks/ingest'

let root: string
let spoolDir: string

function envelopeFor(payload: Record<string, unknown>, eventId = 'evt-1') {
  return {
    receivedAt: Date.now(),
    relayVersion: 'test',
    eventId,
    payload,
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccw-ingest-'))
  spoolDir = join(root, 'spool')
  await mkdir(spoolDir, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('HookSpoolIngest', () => {
  it('ingests a spool file and removes it', async () => {
    let resolveEvent: (event: NormalizedHookEvent) => void = () => undefined
    const received = new Promise<NormalizedHookEvent>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for ingest')), 3_000)
      resolveEvent = (event) => {
        clearTimeout(timer)
        resolve(event)
      }
    })

    const ingest = new HookSpoolIngest(
      spoolDir,
      (event) => resolveEvent(event),
      () => undefined,
    )

    await writeFile(
      join(spoolDir, '1-event.json'),
      JSON.stringify(
        envelopeFor({
          session_id: 'session-1',
          hook_event_name: 'UserPromptSubmit',
          cwd: 'C:\\work\\project',
        }),
      ),
      'utf8',
    )

    try {
      await ingest.start()
      const event = await received
      expect(event.name).toBe('UserPromptSubmit')
      expect(event.sessionId).toBe('session-1')
      expect(await readdir(spoolDir)).toHaveLength(0)
    } finally {
      ingest.stop()
    }
  })

  it('drops malformed spool files without throwing', async () => {
    const errors: string[] = []
    const ingest = new HookSpoolIngest(
      spoolDir,
      () => undefined,
      (message) => errors.push(message),
    )

    await writeFile(join(spoolDir, 'bad.json'), '{ not json', 'utf8')

    try {
      await ingest.start()
      expect(errors.length).toBeGreaterThan(0)
      expect(await readdir(spoolDir)).toHaveLength(0)
    } finally {
      ingest.stop()
    }
  })
})
