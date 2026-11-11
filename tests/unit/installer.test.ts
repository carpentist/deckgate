import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MONITORED_HOOK_EVENTS } from '@shared/types/hooks'
import { GATE_MARKER, HookInstaller, RELAY_MARKER } from '../../src/main/hooks/installer'

let root: string
let settingsPath: string
let relayPath: string
let gatePath: string
let backupDir: string
let installer: HookInstaller

async function writeSettings(value: unknown): Promise<string> {
  const raw = `${JSON.stringify(value, null, 2)}\n`
  await writeFile(settingsPath, raw, 'utf8')
  return raw
}

async function readJson(): Promise<Record<string, any>> {
  return JSON.parse(await readFile(settingsPath, 'utf8')) as Record<string, any>
}

function countMarker(text: string): number {
  return text.split(RELAY_MARKER).length - 1
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccw-installer-'))
  settingsPath = join(root, '.claude', 'settings.json')
  relayPath = join(root, 'relay.cjs')
  gatePath = join(root, 'gate.cjs')
  backupDir = join(root, 'backups')
  await mkdir(join(root, '.claude'), { recursive: true })
  await writeFile(relayPath, '// test relay\n', 'utf8')
  await writeFile(gatePath, '// test gate\n', 'utf8')
  installer = new HookInstaller({
    settingsPath,
    relayPath,
    gatePath,
    nodePath: 'node',
    backupDir,
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('HookInstaller', () => {
  it('installs only its own hooks and preserves existing settings', async () => {
    const original = {
      env: { SECRET: 'keep-me' },
      theme: 'dark',
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-hook' }] },
        ],
      },
    }
    const raw = await writeSettings(original)

    const status = await installer.install()
    expect(status.installed).toBe(true)
    expect(status.gateInstalled).toBe(true)
    expect(status.missingEvents).toEqual([])
    expect(status.outdated).toBe(false)
    expect(status.error).toBeNull()

    const installedRaw = await readFile(settingsPath, 'utf8')
    const installed = await readJson()
    expect(installed.env.SECRET).toBe('keep-me')
    expect(installed.theme).toBe('dark')
    expect(installed.hooks.PreToolUse).toHaveLength(2)
    expect(countMarker(installedRaw)).toBe(MONITORED_HOOK_EVENTS.length)
    expect(installedRaw.split(GATE_MARKER).length - 1).toBe(1)

    const backups = await readdir(backupDir)
    expect(backups).toHaveLength(1)
    expect(await readFile(join(backupDir, backups[0]!), 'utf8')).toBe(raw)

    expect(installed.hooks.SessionEnd[0].hooks[0]).toMatchObject({ timeout: 2 })
    expect(installed.hooks.SessionEnd[0].hooks[0].async).toBeUndefined()
    expect(installed.hooks.PreToolUse[1].hooks[0]).toMatchObject({
      async: true,
      timeout: 2,
    })
  })

  it('is idempotent when installed twice', async () => {
    await writeSettings({})
    await installer.install()
    const first = await readFile(settingsPath, 'utf8')
    await installer.install()
    const second = await readFile(settingsPath, 'utf8')

    expect(countMarker(second)).toBe(countMarker(first))
    expect(countMarker(second)).toBe(MONITORED_HOOK_EVENTS.length)
    expect(await readdir(backupDir)).toHaveLength(1)
  })

  it('uninstalls only its own hooks and keeps user configuration', async () => {
    await writeSettings({
      env: { SECRET: 'keep-me' },
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-hook' }] },
        ],
      },
    })
    await installer.install()
    const status = await installer.uninstall()

    expect(status.installed).toBe(false)
    expect(status.gateInstalled).toBe(false)
    const raw = await readFile(settingsPath, 'utf8')
    const parsed = await readJson()
    expect(countMarker(raw)).toBe(0)
    expect(raw.includes(GATE_MARKER)).toBe(false)
    expect(parsed.env.SECRET).toBe('keep-me')
    expect(parsed.hooks.PreToolUse).toHaveLength(1)
    expect(parsed.hooks.Stop).toBeUndefined()
    expect(await readdir(backupDir)).toHaveLength(2)
  })

  it('refuses to modify an invalid settings file', async () => {
    await writeFile(settingsPath, '{ not valid json', 'utf8')
    const status = await installer.install()

    expect(status.installed).toBe(false)
    expect(status.error).not.toBeNull()
    expect(await readFile(settingsPath, 'utf8')).toBe('{ not valid json')
    await expect(access(backupDir)).rejects.toThrow()
  })

  it('refuses to overwrite a non-array hooks field', async () => {
    const original = await writeSettings({ hooks: { Stop: { unexpected: true } } })
    const status = await installer.install()

    expect(status.error).toContain('Stop')
    expect(await readFile(settingsPath, 'utf8')).toBe(original)
  })

  it('creates settings when missing and works without a relay file', async () => {
    await rm(relayPath)
    const missingRelay = await installer.install()
    expect(missingRelay.error).not.toBeNull()
    await expect(access(settingsPath)).rejects.toThrow()

    await writeFile(relayPath, '// restored\n', 'utf8')
    const status = await installer.install()
    expect(status.installed).toBe(true)
    expect(await readFile(settingsPath, 'utf8')).toContain(RELAY_MARKER)
  })
})
