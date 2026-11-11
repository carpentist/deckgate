import type { HookStatus, WatcherSnapshot } from './types/session'
import type { AppSettings, SoundKind } from './types/settings'

export const IPC_CHANNELS = {
  getSnapshot: 'watcher:get-snapshot',
  refresh: 'watcher:refresh',
  sessionsUpdated: 'watcher:sessions-updated',
  copyText: 'watcher:copy-text',
  openPath: 'watcher:open-path',
  getHookStatus: 'watcher:get-hook-status',
  installHooks: 'watcher:install-hooks',
  uninstallHooks: 'watcher:uninstall-hooks',
  updateSettings: 'watcher:update-settings',
  hideWindow: 'watcher:hide-window',
  playSound: 'watcher:play-sound',
  focusSession: 'watcher:focus-session',
  testNotification: 'watcher:test-notification',
  approvalDecision: 'watcher:approval-decision',
  clearHistory: 'watcher:clear-history',
  quitApp: 'watcher:quit-app',
} as const

export interface WatcherApi {
  getSnapshot: () => Promise<WatcherSnapshot>
  refresh: () => Promise<WatcherSnapshot>
  onSessionsUpdated: (listener: (snapshot: WatcherSnapshot) => void) => () => void
  copyText: (text: string) => Promise<void>
  openPath: (target: string) => Promise<void>
  getHookStatus: () => Promise<HookStatus>
  installHooks: () => Promise<HookStatus>
  uninstallHooks: () => Promise<HookStatus>
  updateSettings: (patch: Partial<AppSettings>) => Promise<WatcherSnapshot>
  hideWindow: () => Promise<void>
  onPlaySound: (listener: (kind: SoundKind) => void) => () => void
  onFocusSession: (listener: (sessionId: string) => void) => () => void
  testNotification: () => Promise<void>
  approvalDecision: (
    requestId: string,
    behavior: 'allow' | 'deny' | 'fallback',
  ) => Promise<void>
  clearHistory: () => Promise<void>
  quitApp: () => Promise<void>
}
