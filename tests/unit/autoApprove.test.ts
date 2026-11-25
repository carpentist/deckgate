import { describe, expect, it } from 'vitest'
import {
  evaluateAutoApprove,
  findBlockedCommand,
  findBlockedTool,
  getToolCommand,
  isPermissionModeInterceptable,
} from '../../src/shared/autoApprove'
import { DEFAULT_APP_SETTINGS } from '../../src/shared/types/settings'

describe('permission mode policy', () => {
  it('intercepts only manual-style modes', () => {
    expect(isPermissionModeInterceptable(null)).toBe(true)
    expect(isPermissionModeInterceptable('default')).toBe(true)
    expect(isPermissionModeInterceptable('manual')).toBe(true)
    expect(isPermissionModeInterceptable('acceptEdits')).toBe(true)
    expect(isPermissionModeInterceptable('AUTO')).toBe(false)
    expect(isPermissionModeInterceptable('auto')).toBe(false)
    expect(isPermissionModeInterceptable('dontAsk')).toBe(false)
    expect(isPermissionModeInterceptable('plan')).toBe(false)
    expect(isPermissionModeInterceptable('bypassPermissions')).toBe(false)
    expect(isPermissionModeInterceptable('some-future-mode')).toBe(false)
  })
})

describe('auto-approve policy', () => {
  it('matches blocked tools case-insensitively', () => {
    expect(findBlockedTool('Write', ['write', 'edit'])).toBe('write')
    expect(findBlockedTool('PowerShell', ['Write'])).toBeNull()
  })

  it('extracts commands and blocks dangerous fragments', () => {
    expect(getToolCommand({ command: 'git status' })).toBe('git status')
    expect(getToolCommand({ file_path: 'a.txt' })).toBeNull()

    expect(findBlockedCommand('git status', ['rm -rf'])).toBeNull()
    expect(findBlockedCommand('git status && rm -rf', ['&&'])).toBe('&&')
    expect(findBlockedCommand('echo a | more', ['|'])).toBe('|')
    expect(findBlockedCommand('rm   -rf C:\\data', ['rm -rf'])).toBe('rm -rf')
    expect(findBlockedCommand('echo ok\necho again', [])).toBeNull()
    expect(findBlockedCommand('echo ok\nrm -rf C:\\data', ['rm -rf'])).toBe('rm -rf')
  })

  it('uses the default command blacklist', () => {
    expect(DEFAULT_APP_SETTINGS.autoApproveBlockedTools).toEqual([])
    expect(
      findBlockedCommand('echo ok | more', DEFAULT_APP_SETTINGS.autoApproveBlockedCommands),
    ).toBeNull()
    expect(
      findBlockedCommand('rm -rf C:\\data', DEFAULT_APP_SETTINGS.autoApproveBlockedCommands),
    ).toBe('rm -rf')
  })

  it('allows when neither global nor session rules match', () => {
    expect(
      evaluateAutoApprove({
        toolName: 'PowerShell',
        toolInput: { command: 'git status' },
        globalBlockedTools: [],
        globalBlockedCommands: [],
        sessionBlockedTools: [],
        sessionBlockedCommands: [],
      }),
    ).toEqual({ allowed: true, reason: null })
  })

  it('reports the global rules before session rules', () => {
    expect(
      evaluateAutoApprove({
        toolName: 'Write',
        toolInput: { file_path: 'a.txt' },
        globalBlockedTools: ['Write'],
        globalBlockedCommands: [],
        sessionBlockedTools: ['Write'],
        sessionBlockedCommands: [],
      }),
    ).toEqual({ allowed: false, reason: '工具 Write 在全局黑名单中' })

    expect(
      evaluateAutoApprove({
        toolName: 'Edit',
        toolInput: { file_path: 'a.txt' },
        globalBlockedTools: [],
        globalBlockedCommands: [],
        sessionBlockedTools: ['Edit'],
        sessionBlockedCommands: [],
      }),
    ).toEqual({ allowed: false, reason: '工具 Edit 在本会话黑名单中' })
  })

  it('blocks commands from either layer', () => {
    expect(
      evaluateAutoApprove({
        toolName: 'PowerShell',
        toolInput: { command: 'git reset --hard' },
        globalBlockedTools: [],
        globalBlockedCommands: ['git reset --hard'],
        sessionBlockedTools: [],
        sessionBlockedCommands: [],
      }),
    ).toEqual({
      allowed: false,
      reason: '命中全局危险命令规则：git reset --hard',
    })

    expect(
      evaluateAutoApprove({
        toolName: 'PowerShell',
        toolInput: { command: 'npm publish' },
        globalBlockedTools: [],
        globalBlockedCommands: [],
        sessionBlockedTools: [],
        sessionBlockedCommands: ['npm publish'],
      }),
    ).toEqual({
      allowed: false,
      reason: '命中本会话危险命令规则：npm publish',
    })
  })
})
