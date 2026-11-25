import { describe, expect, it } from 'vitest'
import { SessionPolicyStore } from '../../src/main/sessionPolicy/store'

describe('SessionPolicyStore', () => {
  it('returns an empty policy for unknown sessions', () => {
    const store = new SessionPolicyStore()
    expect(store.get('missing')).toEqual({
      autoApprove: false,
      blockedTools: [],
      blockedCommands: [],
    })
  })

  it('stores session-level switches and blacklists independently', () => {
    const store = new SessionPolicyStore()
    store.update('session-a', { autoApprove: true })
    store.update('session-b', {
      blockedCommands: ['npm publish'],
    })

    expect(store.get('session-a')).toEqual({
      autoApprove: true,
      blockedTools: [],
      blockedCommands: [],
    })
    expect(store.get('session-b')).toEqual({
      autoApprove: false,
      blockedTools: [],
      blockedCommands: ['npm publish'],
    })
    expect(store.snapshot()['session-b']?.blockedCommands).toEqual(['npm publish'])
  })

  it('trims and deduplicates blacklist values', () => {
    const store = new SessionPolicyStore()
    store.update('session-a', {
      blockedTools: [' Write ', 'write', '', 'Edit'],
      blockedCommands: ['  rm -rf  ', 'RM -RF'],
    })
    expect(store.get('session-a')).toEqual({
      autoApprove: false,
      blockedTools: ['Write', 'Edit'],
      blockedCommands: ['rm -rf'],
    })
  })

  it('clears auto switches but keeps blacklists when stopping all sessions', () => {
    const store = new SessionPolicyStore()
    store.update('session-a', {
      autoApprove: true,
      blockedCommands: ['git reset --hard'],
    })
    store.update('session-b', { autoApprove: true })

    store.clearAllAuto()

    expect(store.get('session-a').autoApprove).toBe(false)
    expect(store.get('session-a').blockedCommands).toEqual(['git reset --hard'])
    expect(store.get('session-b').autoApprove).toBe(false)
  })

  it('drops a policy when nothing remains', () => {
    const store = new SessionPolicyStore()
    store.update('session-a', { autoApprove: true })
    store.update('session-a', { autoApprove: false })
    expect(store.snapshot()).toEqual({})
  })

  it('clears and prunes session policies', () => {
    const store = new SessionPolicyStore()
    store.update('session-a', { autoApprove: true })
    store.update('session-b', { autoApprove: true })

    store.prune(new Set(['session-a']))
    expect(Object.keys(store.snapshot())).toEqual(['session-a'])

    store.clearAll()
    expect(store.snapshot()).toEqual({})
  })
})
