import { describe, expect, it } from 'vitest'
import { normalizeSettings } from '../../src/shared/schemas/settings'
import { DEFAULT_APP_SETTINGS } from '../../src/shared/types/settings'

describe('settings normalization', () => {
  it('ignores legacy project-level auto-approval keys', () => {
    const settings = normalizeSettings({
      approvalEnabled: true,
      autoApproveAll: true,
      autoApproveAllProjects: true,
      autoApproveProjects: ['C:\\project'],
      autoApproveBlockedCommands: ['rm -rf'],
    })

    expect(settings).toEqual({
      ...DEFAULT_APP_SETTINGS,
      approvalEnabled: true,
      autoApproveBlockedCommands: ['rm -rf'],
    })
    expect('autoApproveAll' in settings).toBe(false)
    expect('autoApproveProjects' in settings).toBe(false)
  })

  it('falls back to defaults for invalid settings', () => {
    expect(normalizeSettings({ approvalWaitSec: 'soon' })).toEqual(DEFAULT_APP_SETTINGS)
  })
})
