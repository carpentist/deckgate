import type { AppSettings, ApprovalRequestView } from './settings'

export const SESSION_STATUSES = [
  'RUNNING',
  'WAITING_PERMISSION',
  'WAITING_INPUT',
  'COMPLETED',
  'FAILED',
  'STOPPED',
  'UNKNOWN',
  'DISCONNECTED',
] as const

export type SessionStatus = (typeof SESSION_STATUSES)[number]

export type Confidence = 'high' | 'medium' | 'low'

export type AttentionType = 'permission' | 'question' | 'failure' | 'abnormal-exit' | 'idle'

export interface Attention {
  type: AttentionType
  since: number
  toolName: string | null
  reason: string
}

export type EventSeverity = 'info' | 'warning' | 'error'

export interface SessionEventView {
  id: string
  at: number
  name: string
  summary: string
  toolName: string | null
  severity: EventSeverity
}

export interface Session {
  sessionId: string
  pid: number | null
  cwd: string
  projectName: string
  status: SessionStatus
  statusReason: string
  confidence: Confidence
  currentTool: string | null
  lastError: string | null
  attention: Attention | null
  startedAt: number
  lastEventAt: number
  lastActivityAt: number
  lastAssistantMessage: string | null
  recentEvents: SessionEventView[]
  alive: boolean | null
  hookDriven: boolean
  exitKind: 'normal' | 'abnormal' | null
  sourceTerminal: string | null
  procStart: string | null
  waitingFor: string | null
  sessionFileStatus: string | null
  sessionFileUpdatedAt: number | null
}

export interface HookStatus {
  installed: boolean
  gateInstalled: boolean
  settingsPath: string
  relayPath: string
  backupDir: string
  events: string[]
  missingEvents: string[]
  outdated: boolean
  error: string | null
}

export interface WatcherSnapshot {
  sessions: Session[]
  generatedAt: number
  hookStatus: HookStatus
  settings: AppSettings
  approvals: ApprovalRequestView[]
}
