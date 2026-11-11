import { z } from 'zod'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '../types/settings'

export const appSettingsSchema = z.object({
  notificationsEnabled: z.boolean(),
  soundEnabled: z.boolean(),
  notifyOnPermission: z.boolean(),
  notifyOnQuestion: z.boolean(),
  notifyOnCompletion: z.boolean(),
  notifyOnFailure: z.boolean(),
  notifyOnAbnormalExit: z.boolean(),
  notificationCooldownSec: z.number().int().min(0).max(3600),
  alwaysOnTop: z.boolean(),
  miniMode: z.boolean(),
  approvalEnabled: z.boolean(),
  approvalWaitSec: z.number().int().min(60).max(600),
  autoApproveAll: z.boolean(),
  autoApproveAllProjects: z.boolean(),
  autoApproveProjects: z.array(z.string().trim().min(1).max(1024)).max(100),
  autoApproveBlockedTools: z.array(z.string().trim().min(1).max(100)).max(200),
  autoApproveBlockedCommands: z.array(z.string().min(1).max(200)).max(200),
  showOnApproval: z.boolean(),
  pollIntervalMs: z.number().int().min(2000).max(30_000),
  useSessionFileSignals: z.boolean(),
  historyRetentionDays: z.number().int().min(1).max(365),
})

export const appSettingsPatchSchema = appSettingsSchema.partial()

export function normalizeSettings(input: unknown): AppSettings {
  const parsed = appSettingsPatchSchema.safeParse(input)
  if (!parsed.success) return { ...DEFAULT_APP_SETTINGS }
  return { ...DEFAULT_APP_SETTINGS, ...parsed.data }
}
