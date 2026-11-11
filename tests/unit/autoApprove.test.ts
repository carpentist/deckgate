import { describe, expect, it } from 'vitest'
import {
  findBlockedCommand,
  findBlockedTool,
  getToolCommand,
  isProjectAutoApproved,
  normalizeProjectPath,
} from '../../src/shared/autoApprove'
import { DEFAULT_APP_SETTINGS } from '../../src/shared/types/settings'

describe('auto-approve policy', () => {
  it('normalizes project paths and matches only the selected project', () => {
    expect(normalizeProjectPath('C:/Work/Foo/')).toBe('c:\\work\\foo')
    expect(isProjectAutoApproved('C:\\Work\\Foo', ['c:/work/foo'])).toBe(true)
    expect(isProjectAutoApproved('C:\\Work\\Foo\\sub', ['C:\\Work\\Foo'])).toBe(false)
    expect(isProjectAutoApproved('C:\\Work\\FooBar', ['C:\\Work\\Foo'])).toBe(false)
    expect(isProjectAutoApproved(null, ['C:\\Work\\Foo'])).toBe(false)
  })

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

  it('uses a wider default auto-approval scope', () => {
    expect(DEFAULT_APP_SETTINGS.autoApproveBlockedTools).toEqual([])
    expect(
      findBlockedCommand('echo ok | more', DEFAULT_APP_SETTINGS.autoApproveBlockedCommands),
    ).toBeNull()
    expect(
      findBlockedCommand('rm -rf C:\\data', DEFAULT_APP_SETTINGS.autoApproveBlockedCommands),
    ).toBe('rm -rf')
  })
})
