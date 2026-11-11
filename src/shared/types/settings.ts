export interface AppSettings {
  notificationsEnabled: boolean
  soundEnabled: boolean
  notifyOnPermission: boolean
  notifyOnQuestion: boolean
  notifyOnCompletion: boolean
  notifyOnFailure: boolean
  notifyOnAbnormalExit: boolean
  notificationCooldownSec: number
  alwaysOnTop: boolean
  miniMode: boolean
  approvalEnabled: boolean
  approvalWaitSec: number
  autoApproveAll: boolean
  autoApproveAllProjects: boolean
  autoApproveProjects: string[]
  autoApproveBlockedTools: string[]
  autoApproveBlockedCommands: string[]
  showOnApproval: boolean
  pollIntervalMs: number
  useSessionFileSignals: boolean
  historyRetentionDays: number
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  notificationsEnabled: true,
  soundEnabled: true,
  notifyOnPermission: true,
  notifyOnQuestion: true,
  notifyOnCompletion: false,
  notifyOnFailure: true,
  notifyOnAbnormalExit: true,
  notificationCooldownSec: 30,
  alwaysOnTop: false,
  miniMode: false,
  approvalEnabled: false,
  approvalWaitSec: 600,
  autoApproveAll: false,
  autoApproveAllProjects: false,
  autoApproveProjects: [],
  autoApproveBlockedTools: [],
  autoApproveBlockedCommands: [
    'rm -rf',
    'remove-item',
    'del /f',
    'del /s',
    'rd /s',
    'rmdir /s',
    'format c:',
    'format /',
    'diskpart',
    'shutdown',
    'restart-computer',
    'stop-computer',
    'reg delete',
    'reg add',
    'takeown',
    'icacls',
    'git reset --hard',
    'git clean -fd',
    'invoke-expression',
    'set-executionpolicy',
  ],
  showOnApproval: true,
  pollIntervalMs: 5000,
  useSessionFileSignals: true,
  historyRetentionDays: 30,
}

export type SoundKind = 'attention' | 'success' | 'error'

export interface ApprovalRequestView {
  requestId: string
  sessionId: string
  projectName: string
  cwd: string
  toolName: string
  inputPreview: string
  receivedAt: number
  expiresAt: number
  autoApproveBlockedReason: string | null
}
