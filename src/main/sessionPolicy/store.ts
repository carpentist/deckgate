import type { SessionPolicyView } from '@shared/types/settings'

const MAX_LIST_ITEMS = 200
const MAX_TOOL_LENGTH = 100
const MAX_COMMAND_LENGTH = 200

function normalizeList(values: string[], maxLength: number): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || trimmed.length > maxLength) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
    if (result.length >= MAX_LIST_ITEMS) break
  }
  return result
}

export function emptySessionPolicy(): SessionPolicyView {
  return { autoApprove: false, blockedTools: [], blockedCommands: [] }
}

export class SessionPolicyStore {
  private readonly policies = new Map<string, SessionPolicyView>()

  get(sessionId: string): SessionPolicyView {
    const policy = this.policies.get(sessionId)
    if (!policy) return emptySessionPolicy()
    return {
      autoApprove: policy.autoApprove,
      blockedTools: [...policy.blockedTools],
      blockedCommands: [...policy.blockedCommands],
    }
  }

  update(sessionId: string, patch: Partial<SessionPolicyView>): SessionPolicyView {
    const current = this.get(sessionId)
    const next: SessionPolicyView = {
      autoApprove: patch.autoApprove ?? current.autoApprove,
      blockedTools: patch.blockedTools
        ? normalizeList(patch.blockedTools, MAX_TOOL_LENGTH)
        : current.blockedTools,
      blockedCommands: patch.blockedCommands
        ? normalizeList(patch.blockedCommands, MAX_COMMAND_LENGTH)
        : current.blockedCommands,
    }

    if (
      !next.autoApprove &&
      next.blockedTools.length === 0 &&
      next.blockedCommands.length === 0
    ) {
      this.policies.delete(sessionId)
      return emptySessionPolicy()
    }

    this.policies.set(sessionId, next)
    return this.get(sessionId)
  }

  resetAuto(sessionId: string): void {
    const policy = this.policies.get(sessionId)
    if (!policy || !policy.autoApprove) return
    this.update(sessionId, { autoApprove: false })
  }

  clearAllAuto(): void {
    for (const [sessionId, policy] of this.policies) {
      if (!policy.autoApprove) continue
      this.policies.set(sessionId, { ...policy, autoApprove: false })
    }
  }

  clear(sessionId: string): void {
    this.policies.delete(sessionId)
  }

  clearAll(): void {
    this.policies.clear()
  }

  prune(validSessionIds: Set<string>): void {
    for (const sessionId of this.policies.keys()) {
      if (!validSessionIds.has(sessionId)) this.policies.delete(sessionId)
    }
  }

  snapshot(): Record<string, SessionPolicyView> {
    return Object.fromEntries(
      [...this.policies].map(([sessionId, policy]) => [
        sessionId,
        {
          autoApprove: policy.autoApprove,
          blockedTools: [...policy.blockedTools],
          blockedCommands: [...policy.blockedCommands],
        },
      ]),
    )
  }
}
