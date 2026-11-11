import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { HookStatus } from '@shared/types/session'
import { MONITORED_HOOK_EVENTS } from '@shared/types/hooks'

export const RELAY_MARKER = '--ccw-hook-relay'
export const GATE_MARKER = '--ccw-hook-gate'
export const HOOKS_VERSION_MARKER = '--ccw-hooks-v2'

type JsonObject = Record<string, unknown>

interface SettingsSnapshot {
  root: JsonObject
  existed: boolean
  raw: string | null
}

export interface HookInstallerOptions {
  settingsPath: string
  relayPath: string
  gatePath: string
  nodePath: string
  backupDir: string
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function commandIncludesMarker(command: unknown): boolean {
  return typeof command === 'string' && command.includes(RELAY_MARKER)
}

function isOurCommand(command: unknown): boolean {
  return (
    typeof command === 'string' &&
    (command.includes(RELAY_MARKER) || command.includes(GATE_MARKER))
  )
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortKeys(item)]),
    )
  }
  return value
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function findInstalledEvents(root: JsonObject): string[] {
  if (!isRecord(root['hooks'])) return []
  const hooks = root['hooks']
  const installed: string[] = []
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue
    const found = groups.some(
      (group) =>
        isRecord(group) &&
        Array.isArray(group['hooks']) &&
        group['hooks'].some((hook) => isRecord(hook) && commandIncludesMarker(hook['command'])),
    )
    if (found) installed.push(event)
  }
  return installed.sort()
}

function findGateInstalled(root: JsonObject): boolean {
  if (!isRecord(root['hooks'])) return false
  return Object.values(root['hooks']).some(
    (groups) =>
      Array.isArray(groups) &&
      groups.some(
        (group) =>
          isRecord(group) &&
          Array.isArray(group['hooks']) &&
          group['hooks'].some(
            (hook) =>
              isRecord(hook) &&
              typeof hook['command'] === 'string' &&
              hook['command'].includes(GATE_MARKER),
          ),
      ),
  )
}

function findOurCommands(root: JsonObject): string[] {
  if (!isRecord(root['hooks'])) return []
  const commands: string[] = []
  for (const groups of Object.values(root['hooks'])) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      if (!isRecord(group) || !Array.isArray(group['hooks'])) continue
      for (const hook of group['hooks']) {
        if (isRecord(hook) && isOurCommand(hook['command'])) {
          commands.push(hook['command'] as string)
        }
      }
    }
  }
  return commands
}

function allOurHooksVersioned(root: JsonObject): boolean {
  const commands = findOurCommands(root)
  return commands.length > 0 &&
    commands.every((command) => command.includes(HOOKS_VERSION_MARKER))
}

function backupName(now: Date): string {
  const suffix = Math.random().toString(36).slice(2, 8)
  return `settings-${now.toISOString().replace(/[:.]/g, '-')}-${suffix}.json`
}

export class HookInstaller {
  constructor(private readonly options: HookInstallerOptions) {}

  async status(): Promise<HookStatus> {
    const base = {
      settingsPath: this.options.settingsPath,
      relayPath: this.options.relayPath,
      backupDir: this.options.backupDir,
      events: [...MONITORED_HOOK_EVENTS],
    }
    try {
      const snapshot = await this.readSettings()
      const installedEvents = findInstalledEvents(snapshot.root)
      const gateInstalled = findGateInstalled(snapshot.root)
      const missingEvents = MONITORED_HOOK_EVENTS.filter(
        (event) => !installedEvents.includes(event),
      )
      const outdated =
        installedEvents.length > 0 &&
        (missingEvents.length > 0 ||
          !gateInstalled ||
          !allOurHooksVersioned(snapshot.root))
      return {
        ...base,
        installed: installedEvents.length > 0,
        gateInstalled,
        missingEvents,
        outdated,
        error: null,
      }
    } catch (error) {
      return {
        ...base,
        installed: false,
        gateInstalled: false,
        missingEvents: [...MONITORED_HOOK_EVENTS],
        outdated: false,
        error: this.describeError(error),
      }
    }
  }

  async install(): Promise<HookStatus> {
    try {
      await fs.access(this.options.relayPath)
      await fs.access(this.options.gatePath)
      if (this.options.nodePath !== 'node') {
        await fs.access(this.options.nodePath)
      }
      const snapshot = await this.readSettings()
      const root = snapshot.root

      if (root['hooks'] !== undefined && !isRecord(root['hooks'])) {
        throw new Error('hooks 字段不是对象，已中止以保护现有配置')
      }
      const hooks = isRecord(root['hooks']) ? root['hooks'] : {}

      for (const event of MONITORED_HOOK_EVENTS) {
        const existing = hooks[event]
        if (existing !== undefined && !Array.isArray(existing)) {
          throw new Error(`${event} 的 hooks 配置不是数组，已中止以保护现有配置`)
        }
      }

      const before = stableStringify({ hooks })

      for (const [event, groups] of Object.entries(hooks)) {
        if (!Array.isArray(groups)) continue
        const nextGroups: unknown[] = []
        for (const group of groups) {
          if (!isRecord(group) || !Array.isArray(group['hooks'])) {
            nextGroups.push(group)
            continue
          }
          const remaining = group['hooks'].filter(
            (hook) => !(isRecord(hook) && isOurCommand(hook['command'])),
          )
          if (remaining.length > 0) nextGroups.push({ ...group, hooks: remaining })
        }
        if (nextGroups.length > 0) hooks[event] = nextGroups
        else delete hooks[event]
      }

      for (const event of MONITORED_HOOK_EVENTS) {
        const groups = Array.isArray(hooks[event]) ? hooks[event] : []
        const command = `"${this.options.nodePath}" "${this.options.relayPath}" ${RELAY_MARKER} ${HOOKS_VERSION_MARKER} ${event}`
        groups.push({
          hooks: [
            event === 'SessionEnd'
              ? { type: 'command', command, timeout: 2 }
              : { type: 'command', command, async: true, asyncTimeout: 10, timeout: 2 },
          ],
        })
        hooks[event] = groups
      }

      const permissionGroups = Array.isArray(hooks['PermissionRequest'])
        ? hooks['PermissionRequest']
        : []
      permissionGroups.push({
        hooks: [
          {
            type: 'command',
            command: `"${this.options.nodePath}" "${this.options.gatePath}" ${GATE_MARKER} ${HOOKS_VERSION_MARKER}`,
            timeout: 700,
          },
        ],
      })
      hooks['PermissionRequest'] = permissionGroups

      const after = stableStringify({ hooks })
      if (before !== after) {
        root['hooks'] = hooks
        await this.writeWithBackup(snapshot, root)
      }
      return await this.status()
    } catch (error) {
      return {
        installed: false,
        gateInstalled: false,
        settingsPath: this.options.settingsPath,
        relayPath: this.options.relayPath,
        backupDir: this.options.backupDir,
        events: [...MONITORED_HOOK_EVENTS],
        missingEvents: [...MONITORED_HOOK_EVENTS],
        outdated: false,
        error: this.describeError(error),
      }
    }
  }

  async uninstall(): Promise<HookStatus> {
    try {
      const snapshot = await this.readSettings()
      const root = snapshot.root
      if (!isRecord(root['hooks'])) return await this.status()

      const hooks = root['hooks']
      let changed = false

      for (const [event, groups] of Object.entries(hooks)) {
        if (!Array.isArray(groups)) continue
        const nextGroups: unknown[] = []
        let eventChanged = false

        for (const group of groups) {
          if (!isRecord(group) || !Array.isArray(group['hooks'])) {
            nextGroups.push(group)
            continue
          }
          const remaining = group['hooks'].filter(
            (hook) => !(isRecord(hook) && isOurCommand(hook['command'])),
          )
          if (remaining.length !== group['hooks'].length) eventChanged = true
          if (remaining.length > 0) nextGroups.push({ ...group, hooks: remaining })
        }

        if (eventChanged) {
          changed = true
          if (nextGroups.length > 0) hooks[event] = nextGroups
          else delete hooks[event]
        }
      }

      if (changed) {
        if (Object.keys(hooks).length === 0) delete root['hooks']
        await this.writeWithBackup(snapshot, root)
      }
      return await this.status()
    } catch (error) {
      return {
        installed: false,
        gateInstalled: false,
        settingsPath: this.options.settingsPath,
        relayPath: this.options.relayPath,
        backupDir: this.options.backupDir,
        events: [...MONITORED_HOOK_EVENTS],
        missingEvents: [...MONITORED_HOOK_EVENTS],
        outdated: false,
        error: this.describeError(error),
      }
    }
  }

  private async readSettings(): Promise<SettingsSnapshot> {
    try {
      const raw = await fs.readFile(this.options.settingsPath, 'utf8')
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new Error('Claude 设置文件不是合法 JSON，已中止以保护现有配置')
      }
      if (!isRecord(parsed)) {
        throw new Error('Claude 设置文件根节点不是对象，已中止')
      }
      return { root: parsed, existed: true, raw }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { root: {}, existed: false, raw: null }
      }
      throw error
    }
  }

  private async writeWithBackup(snapshot: SettingsSnapshot, root: JsonObject): Promise<void> {
    await fs.mkdir(this.options.backupDir, { recursive: true })
    if (snapshot.existed && snapshot.raw !== null) {
      await fs.writeFile(
        join(this.options.backupDir, backupName(new Date())),
        snapshot.raw,
        { encoding: 'utf8', mode: 0o600 },
      )
    }

    const settingsDir = dirname(this.options.settingsPath)
    await fs.mkdir(settingsDir, { recursive: true })
    const tempPath = `${this.options.settingsPath}.ccw-${process.pid}.tmp`
    await fs.writeFile(tempPath, `${JSON.stringify(root, null, 2)}\n`, 'utf8')
    try {
      await fs.rename(tempPath, this.options.settingsPath)
    } catch (error) {
      await fs.unlink(tempPath).catch(() => undefined)
      throw error
    }
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) return error.message
    return String(error)
  }
}
