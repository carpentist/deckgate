const INTERCEPTABLE_PERMISSION_MODES = new Set(['default', 'manual', 'acceptEdits'])

export function isPermissionModeInterceptable(mode: string | null | undefined): boolean {
  if (!mode) return true
  return INTERCEPTABLE_PERMISSION_MODES.has(mode.trim())
}

export function getToolCommand(toolInput: unknown): string | null {
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) return null
  const command = (toolInput as Record<string, unknown>)['command']
  return typeof command === 'string' ? command : null
}

export function findBlockedTool(
  toolName: string,
  blockedTools: string[],
): string | null {
  const normalizedTool = toolName.trim().toLowerCase()
  for (const blocked of blockedTools) {
    if (blocked.trim().toLowerCase() === normalizedTool) return blocked.trim()
  }
  return null
}

export function findBlockedCommand(
  command: string,
  blockedCommands: string[],
): string | null {
  const text = command.toLowerCase().replace(/\s+/g, ' ')
  for (const blocked of blockedCommands) {
    const pattern = blocked.trim().toLowerCase()
    if (!pattern) continue
    if (text.includes(pattern)) return blocked.trim()
  }
  return null
}

export interface AutoApproveEvaluationInput {
  toolName: string
  toolInput: unknown
  globalBlockedTools: string[]
  globalBlockedCommands: string[]
  sessionBlockedTools: string[]
  sessionBlockedCommands: string[]
}

export interface AutoApproveEvaluation {
  allowed: boolean
  reason: string | null
}

export function evaluateAutoApprove(
  input: AutoApproveEvaluationInput,
): AutoApproveEvaluation {
  const globalTool = findBlockedTool(input.toolName, input.globalBlockedTools)
  if (globalTool) {
    return { allowed: false, reason: `工具 ${globalTool} 在全局黑名单中` }
  }

  const sessionTool = findBlockedTool(input.toolName, input.sessionBlockedTools)
  if (sessionTool) {
    return { allowed: false, reason: `工具 ${sessionTool} 在本会话黑名单中` }
  }

  const command = getToolCommand(input.toolInput)
  if (command) {
    const globalCommand = findBlockedCommand(command, input.globalBlockedCommands)
    if (globalCommand) {
      return { allowed: false, reason: `命中全局危险命令规则：${globalCommand}` }
    }

    const sessionCommand = findBlockedCommand(command, input.sessionBlockedCommands)
    if (sessionCommand) {
      return { allowed: false, reason: `命中本会话危险命令规则：${sessionCommand}` }
    }
  }

  return { allowed: true, reason: null }
}
