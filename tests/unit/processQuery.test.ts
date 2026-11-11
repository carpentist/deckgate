import { describe, expect, it } from 'vitest'
import { parseProcessQueryOutput } from '../../src/main/process/windowsQuery'

describe('parseProcessQueryOutput', () => {
  it('parses an array of processes', () => {
    const result = parseProcessQueryOutput(
      JSON.stringify([
        { id: 123, name: 'claude', start: 1000 },
        { id: 456, name: 'node', start: 2000 },
      ]),
    )
    expect(result.size).toBe(2)
    expect(result.get(123)).toEqual({ pid: 123, name: 'claude', startTimeMs: 1000 })
  })

  it('parses a single process object', () => {
    const result = parseProcessQueryOutput(
      JSON.stringify({ id: 7, name: 'claude', start: 500 }),
    )
    expect(result.get(7)?.name).toBe('claude')
  })

  it('returns an empty map for empty or malformed output', () => {
    expect(parseProcessQueryOutput('').size).toBe(0)
    expect(parseProcessQueryOutput('not json').size).toBe(0)
    expect(parseProcessQueryOutput(JSON.stringify({ id: 'x', name: 'claude' })).size).toBe(0)
  })
})
