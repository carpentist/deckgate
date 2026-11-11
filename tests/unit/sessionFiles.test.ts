import { describe, expect, it } from 'vitest'
import { parseSessionFile } from '../../src/main/process/sessionFiles'

describe('parseSessionFile', () => {
  it('parses a live Claude session file', () => {
    const parsed = parseSessionFile({
      pid: 73448,
      sessionId: 'a78215c0-f9f6-4273-85cd-f08c17d87595',
      cwd: 'C:\\work\\project',
      startedAt: 1793172138679,
      procStart: '639287978349617700',
      version: '2.1.126',
      peerProtocol: 1,
      kind: 'interactive',
      entrypoint: 'cli',
      status: 'waiting',
      waitingFor: 'approve PowerShell',
      updatedAt: 1793172143412,
    })

    expect(parsed).toMatchObject({
      pid: 73448,
      sessionId: 'a78215c0-f9f6-4273-85cd-f08c17d87595',
      cwd: 'C:\\work\\project',
      status: 'waiting',
      waitingFor: 'approve PowerShell',
      updatedAt: 1793172143412,
      kind: 'interactive',
    })
  })

  it('rejects files without a reliable session identity', () => {
    expect(parseSessionFile({ pid: 1, cwd: 'C:\\x', startedAt: 1 })).toBeNull()
    expect(parseSessionFile({ sessionId: 's', cwd: 'C:\\x', startedAt: 1 })).toBeNull()
    expect(parseSessionFile({ pid: 1, sessionId: 's', cwd: 'C:\\x' })).toBeNull()
    expect(parseSessionFile(null)).toBeNull()
  })

  it('strips control characters from displayed fields', () => {
    const parsed = parseSessionFile({
      pid: 1,
      sessionId: 'session-1',
      cwd: `C:\\wo${String.fromCharCode(0)}rk`,
      startedAt: 1,
      status: 'idle',
    })
    expect(parsed?.cwd).toBe('C:\\work')
  })
})
