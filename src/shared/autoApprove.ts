export function normalizeProjectPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return ''
  return trimmed.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

export function isProjectAutoApproved(cwd: string | null, projects: string[]): boolean {
  if (!cwd) return false
  const normalizedCwd = normalizeProjectPath(cwd)
  if (!normalizedCwd) return false

  return projects.some((project) => {
    const normalizedProject = normalizeProjectPath(project)
    return normalizedProject !== '' && normalizedCwd === normalizedProject
  })
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
