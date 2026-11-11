export const MONITORED_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Notification',
  'Stop',
  'StopFailure',
  'SessionEnd',
] as const

export type MonitoredHookEvent = (typeof MONITORED_HOOK_EVENTS)[number]

export interface HookEnvelope {
  receivedAt: number
  relayVersion?: string
  eventId?: string
  payload: unknown
}

export interface NormalizedHookEvent {
  eventId: string
  name: string
  sessionId: string
  cwd: string | null
  transcriptPath: string | null
  receivedAt: number
  permissionMode: string | null
  source: string | null
  reason: string | null
  toolName: string | null
  toolUseId: string | null
  error: string | null
  notificationType: string | null
  message: string | null
  lastAssistantMessage: string | null
  rawSize: number
}
