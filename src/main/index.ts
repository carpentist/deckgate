import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
  type MenuItemConstructorOptions,
} from 'electron'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { IPC_CHANNELS } from '@shared/ipc'
import { copyTextInputSchema, openPathInputSchema } from '@shared/schemas/ipc'
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@shared/types/settings'
import type { HookStatus, Session, WatcherSnapshot } from '@shared/types/session'
import {
  ApprovalCoordinator,
  getApprovalPipeName,
  type ApprovalBehavior,
} from './approval/coordinator'
import { HookInstaller } from './hooks/installer'
import { HookSpoolIngest } from './hooks/ingest'
import { NotificationService } from './notification/service'
import { PersistenceService } from './persistence/service'
import { Database } from './persistence/database'
import { ProcessMonitor } from './process/processMonitor'
import { SessionRegistry } from './session/registry'
import { SessionFileWatcher } from './session/sessionFileWatcher'
import { SettingsStore } from './settings/store'
import { WindowStateStore, type WindowBounds } from './window/state'

const MINI_WIDTH = 410
const MINI_HEIGHT = 240
const NORMAL_MIN_WIDTH = 380
const NORMAL_MIN_HEIGHT = 520

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const registry = new SessionRegistry()

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let ingest: HookSpoolIngest | null = null
let installer: HookInstaller | null = null
let sessionFileWatcher: SessionFileWatcher | null = null
let processMonitor: ProcessMonitor | null = null
let settingsStore: SettingsStore | null = null
let windowState: WindowStateStore | null = null
let notificationService: NotificationService | null = null
let approvalCoordinator: ApprovalCoordinator | null = null
let persistence: PersistenceService | null = null
let appSettings: AppSettings = { ...DEFAULT_APP_SETTINGS }
let hookStatus: HookStatus | null = null
let broadcastTimer: NodeJS.Timeout | null = null
let boundsTimer: NodeJS.Timeout | null = null
let longWaitTimer: NodeJS.Timeout | null = null
let isQuitting = false
let quitFinalized = false
let lastTraySignature = ''

function resolveRelayPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'hooks', 'hook-relay.cjs')
    : join(app.getAppPath(), 'resources', 'hooks', 'hook-relay.cjs')
}

function resolveTrayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'tray.png')
    : join(app.getAppPath(), 'resources', 'tray.png')
}

function resolveGatePath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'hooks', 'hook-gate.cjs')
    : join(app.getAppPath(), 'resources', 'hooks', 'hook-gate.cjs')
}

function resolveNodePath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'runtime', 'node.exe') : 'node'
}

function approvalDataDir(): string {
  const base = process.env['LOCALAPPDATA'] ?? app.getPath('appData')
  return join(base, 'Deckgate')
}

function resolveSpoolDir(): string {
  const base = process.env['LOCALAPPDATA'] ?? app.getPath('appData')
  return join(base, 'Deckgate', 'spool')
}

function resolveSettingsPath(): string {
  const override = process.env['DECKGATE_SETTINGS_PATH']
  return override ? override : join(homedir(), '.claude', 'settings.json')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function currentHookStatus(): HookStatus {
  return (
    hookStatus ?? {
      installed: false,
      gateInstalled: false,
      settingsPath: '',
      relayPath: '',
      backupDir: '',
      events: [],
      missingEvents: [],
      outdated: false,
      error: '初始化中',
    }
  )
}

function buildSnapshot(): WatcherSnapshot {
  return {
    sessions: registry.snapshot(),
    generatedAt: Date.now(),
    hookStatus: currentHookStatus(),
    settings: { ...appSettings },
    approvals: approvalCoordinator?.getRequests() ?? [],
  }
}

function showMainWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function hideMainWindow(): void {
  mainWindow?.hide()
}

function toggleMainWindow(): void {
  if (mainWindow?.isVisible()) hideMainWindow()
  else showMainWindow()
}

async function focusSessionFromNotification(sessionId: string): Promise<void> {
  if (!mainWindow || !settingsStore) return
  if (appSettings.miniMode) {
    appSettings = await settingsStore.update({ miniMode: false })
    await applyMiniMode(mainWindow, false)
    mainWindow.setAlwaysOnTop(appSettings.alwaysOnTop)
    broadcast()
  }
  showMainWindow()
  mainWindow.webContents.send(IPC_CHANNELS.focusSession, sessionId)
}

function pendingSessions(): Session[] {
  return registry
    .snapshot()
    .filter(
      (session) =>
        session.attention?.type === 'permission' || session.attention?.type === 'question',
    )
}

function buildTrayMenu(pending: Session[]): MenuItemConstructorOptions[] {
  const approvals = approvalCoordinator?.getRequests() ?? []
  const pendingLabel =
    pending.length > 0 || approvals.length > 0
      ? `待处理：${pending.length}${approvals.length > 0 ? ` · 授权 ${approvals.length}` : ''}`
      : '暂无待处理'
  const items: MenuItemConstructorOptions[] = [
    { label: '显示窗口', click: showMainWindow },
    { label: '隐藏窗口', click: hideMainWindow },
    { type: 'separator' },
    {
      label: pendingLabel,
      enabled: false,
    },
  ]

  for (const approval of approvals.slice(0, 3)) {
    items.push({
      label: `授权：${approval.projectName} · ${approval.toolName}`,
      click: () => {
        void focusSessionFromNotification(approval.sessionId)
      },
    })
  }

  for (const session of pending.slice(0, 6)) {
    items.push({
      label: `${session.projectName} · ${session.attention?.type === 'question' ? '需要回答' : '需要授权'}`,
      click: () => {
        void focusSessionFromNotification(session.sessionId)
      },
    })
  }

  if (appSettings.autoApproveAll) {
    items.push(
      { type: 'separator' },
      {
        label: '停止自动授权（立即）',
        click: () => void updateAppSettings({ autoApproveAll: false }),
      },
      {
        label: appSettings.autoApproveAllProjects
          ? '自动授权项目：所有项目'
          : `自动授权项目：${appSettings.autoApproveProjects.length}`,
        enabled: false,
      },
    )
  }

  items.push(
    { type: 'separator' },
    {
      label: '桌面通知',
      type: 'checkbox',
      checked: appSettings.notificationsEnabled,
      click: () =>
        void updateAppSettings({ notificationsEnabled: !appSettings.notificationsEnabled }),
    },
    {
      label: '提醒声音',
      type: 'checkbox',
      checked: appSettings.soundEnabled,
      click: () => void updateAppSettings({ soundEnabled: !appSettings.soundEnabled }),
    },
    {
      label: '窗口置顶',
      type: 'checkbox',
      checked: appSettings.alwaysOnTop,
      click: () => void updateAppSettings({ alwaysOnTop: !appSettings.alwaysOnTop }),
    },
    {
      label: '迷你条',
      type: 'checkbox',
      checked: appSettings.miniMode,
      click: () => void updateAppSettings({ miniMode: !appSettings.miniMode }),
    },
    {
      label: '自动授权（高风险）',
      type: 'checkbox',
      checked: appSettings.autoApproveAll,
      click: () =>
        void updateAppSettings({
          autoApproveAll: !appSettings.autoApproveAll,
          ...(appSettings.autoApproveAll ? {} : { approvalEnabled: true }),
        }),
    },
    { type: 'separator' },
    { label: '打开窗口', click: showMainWindow },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  )

  return items
}

function updateTray(): void {
  if (!tray) return
  const pending = pendingSessions()
  const approvals = approvalCoordinator?.getRequests() ?? []
  const signature = JSON.stringify({
    pending: pending.map((session) => [session.sessionId, session.attention?.type]),
    approvals: approvals.map((approval) => approval.requestId),
    settings: {
      notificationsEnabled: appSettings.notificationsEnabled,
      soundEnabled: appSettings.soundEnabled,
      alwaysOnTop: appSettings.alwaysOnTop,
      miniMode: appSettings.miniMode,
      autoApproveAll: appSettings.autoApproveAll,
      approvalEnabled: appSettings.approvalEnabled,
      autoApproveAllProjects: appSettings.autoApproveAllProjects,
      autoApproveProjects: appSettings.autoApproveProjects.length,
    },
  })
  if (signature === lastTraySignature) return
  lastTraySignature = signature
  const total = pending.length + approvals.length
  const autoLabel = appSettings.autoApproveAll
    ? appSettings.autoApproveAllProjects
      ? ' · 自动授权（所有项目）'
      : ` · 自动授权${appSettings.autoApproveProjects.length > 0 ? `（${appSettings.autoApproveProjects.length} 项目）` : '（未选项目）'}`
    : ''
  tray.setToolTip(
    total > 0
      ? `Deckgate · ${total} 个待处理${autoLabel}`
      : `Deckgate${autoLabel}`,
  )
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu(pending)))
}

function createTray(): void {
  try {
    const image = nativeImage.createFromPath(resolveTrayIconPath())
    if (image.isEmpty()) {
      console.warn('[tray] icon missing, close-to-tray disabled')
      return
    }
    tray = new Tray(image.resize({ width: 16, height: 16 }))
    tray.on('click', toggleMainWindow)
    updateTray()
  } catch (error) {
    tray = null
    console.warn('[tray] init failed', String(error))
  }
}

function broadcast(): void {
  const snapshot = buildSnapshot()
  updateTray()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.sessionsUpdated, snapshot)
    }
  }
}

function scheduleBroadcast(): void {
  if (broadcastTimer) return
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null
    broadcast()
  }, 120)
}

function fitBoundsToScreen(bounds: WindowBounds): WindowBounds {
  const display = screen.getDisplayMatching({
    x: bounds.x ?? 0,
    y: bounds.y ?? 0,
    width: bounds.width,
    height: bounds.height,
  })
  const area = display.workArea
  const width = Math.min(bounds.width, area.width)
  const height = Math.min(bounds.height, area.height)
  const x =
    bounds.x === undefined
      ? undefined
      : Math.min(Math.max(bounds.x, area.x), area.x + area.width - width)
  const y =
    bounds.y === undefined
      ? undefined
      : Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)
  return { width, height, ...(x === undefined ? {} : { x }), ...(y === undefined ? {} : { y }) }
}

function persistWindowBounds(): void {
  if (!mainWindow || !windowState || appSettings.miniMode) return
  if (boundsTimer) clearTimeout(boundsTimer)
  boundsTimer = setTimeout(() => {
    boundsTimer = null
    if (!mainWindow || !windowState || appSettings.miniMode) return
    void windowState.save(mainWindow.getBounds())
  }, 300)
}

async function applyMiniMode(window: BrowserWindow, mini: boolean): Promise<void> {
  if (mini) {
    if (windowState) await windowState.save(window.getBounds())
    window.setResizable(false)
    window.setMinimumSize(MINI_WIDTH, MINI_HEIGHT)
    window.setSize(MINI_WIDTH, MINI_HEIGHT, true)
    return
  }

  window.setResizable(true)
  window.setMinimumSize(NORMAL_MIN_WIDTH, NORMAL_MIN_HEIGHT)
  const bounds = windowState ? fitBoundsToScreen(windowState.get()) : { width: 440, height: 700 }
  window.setBounds(bounds, true)
}

async function confirmAutoApprove(): Promise<boolean> {
  const options = {
    type: 'warning' as const,
    buttons: ['取消', '开启自动授权'],
    defaultId: 0,
    cancelId: 0,
    title: '开启自动授权',
    message: '只对勾选的项目自动允许普通工具权限？',
    detail: [
      '不会修改 Claude Code 的 ~/.claude 权限设置，也不会添加“总是允许”规则。',
      '默认只对“自动授权项目”中勾选的项目生效；如果你另外开启“所有项目”，则所有项目都生效。',
      '危险工具/命令黑名单仍会拦截并转为手动卡片；AskUserQuestion 仍回退原终端。',
      '启用后，匹配的权限请求会被绕过，不再询问你。',
    ].join('\n'),
  }
  const window = mainWindow
  const result = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  return result.response === 1
}

async function updateAppSettings(patch: unknown): Promise<WatcherSnapshot> {
  if (!settingsStore) throw new Error('设置尚未初始化')
  const patchRecord = isRecord(patch) ? patch : {}
  const enablingAuto =
    patchRecord['autoApproveAll'] === true && !appSettings.autoApproveAll

  if (enablingAuto && !(await confirmAutoApprove())) {
    return buildSnapshot()
  }

  const effectivePatch: unknown = enablingAuto
    ? { ...patchRecord, approvalEnabled: true }
    : patch

  const previous = appSettings
  appSettings = await settingsStore.update(effectivePatch)
  if (!appSettings.approvalEnabled && appSettings.autoApproveAll) {
    appSettings = await settingsStore.update({ autoApproveAll: false })
  }
  if (!previous.useSessionFileSignals && appSettings.useSessionFileSignals) {
    sessionFileWatcher?.refresh()
  }
  if (previous.approvalEnabled && !appSettings.approvalEnabled) {
    approvalCoordinator?.cancelAll()
  }
  try {
    await persistence?.saveSettings(appSettings)
  } catch (error) {
    console.warn('[persistence] settings save failed', String(error))
  }
  if (previous.historyRetentionDays !== appSettings.historyRetentionDays) {
    void persistence?.prune()
  }
  if (mainWindow) {
    if (previous.miniMode !== appSettings.miniMode) {
      await applyMiniMode(mainWindow, appSettings.miniMode)
    }
    mainWindow.setAlwaysOnTop(appSettings.alwaysOnTop)
  }
  broadcast()
  return buildSnapshot()
}

function createWindow(): void {
  const normalBounds = windowState
    ? fitBoundsToScreen(windowState.get())
    : { width: 440, height: 700 }
  const bounds: WindowBounds = appSettings.miniMode
    ? { width: MINI_WIDTH, height: MINI_HEIGHT }
    : normalBounds

  const window = new BrowserWindow({
    ...bounds,
    resizable: !appSettings.miniMode,
    minWidth: appSettings.miniMode ? MINI_WIDTH : NORMAL_MIN_WIDTH,
    minHeight: appSettings.miniMode ? MINI_HEIGHT : NORMAL_MIN_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    title: 'Deckgate',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow = window
  window.setAlwaysOnTop(appSettings.alwaysOnTop)
  window.once('ready-to-show', () => window.show())
  window.on('resize', persistWindowBounds)
  window.on('move', persistWindowBounds)
  window.on('close', (event) => {
    if (!isQuitting && tray) {
      event.preventDefault()
      window.hide()
    }
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function confirmInstall(): Promise<boolean> {
  if (!installer) return false
  const options = {
    type: 'warning' as const,
    buttons: ['取消', '安装'],
    defaultId: 1,
    cancelId: 0,
    title: '安装监控 Hooks',
    message: '将修改用户级 Claude Code 设置',
    detail: [
      `设置文件：${resolveSettingsPath()}`,
      '',
      '会先备份，可随时卸载；只添加监控 Hooks，不修改权限决策。',
      '已运行的 Claude 会话需要重启后才会生效。',
    ].join('\n'),
  }
  const window = mainWindow
  const result = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  return result.response === 1
}

async function confirmUninstall(): Promise<boolean> {
  const options = {
    type: 'question' as const,
    buttons: ['取消', '卸载'],
    defaultId: 1,
    cancelId: 0,
    title: '卸载监控 Hooks',
    message: '移除本应用添加的 Hooks？',
    detail: '只会删除带有本应用标记的条目，你在 Claude Code 中的其他配置会保留。',
  }
  const window = mainWindow
  const result = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  return result.response === 1
}

function registerIpc(): void {
  ipcMain.handle(IPC_CHANNELS.getSnapshot, () => buildSnapshot())

  ipcMain.handle(IPC_CHANNELS.refresh, async () => {
    if (installer) hookStatus = await installer.status()
    registry.touch()
    return buildSnapshot()
  })

  ipcMain.handle(IPC_CHANNELS.copyText, (_event, text: unknown) => {
    const parsed = copyTextInputSchema.safeParse(text)
    if (!parsed.success) throw new Error('无效的复制内容')
    clipboard.writeText(parsed.data)
  })

  ipcMain.handle(IPC_CHANNELS.openPath, async (_event, target: unknown) => {
    const parsed = openPathInputSchema.safeParse(target)
    if (!parsed.success) throw new Error('无效的目录')
    const known = registry.snapshot().some((session) => session.cwd === parsed.data)
    if (!known) throw new Error('只能打开已识别会话的工作目录')
    const error = await shell.openPath(parsed.data)
    if (error) throw new Error('打开目录失败')
  })

  ipcMain.handle(IPC_CHANNELS.getHookStatus, async () => {
    if (installer) hookStatus = await installer.status()
    return currentHookStatus()
  })

  ipcMain.handle(IPC_CHANNELS.installHooks, async () => {
    if (!installer) throw new Error('安装器尚未初始化')
    if (!(await confirmInstall())) return currentHookStatus()
    hookStatus = await installer.install()
    broadcast()
    return hookStatus
  })

  ipcMain.handle(IPC_CHANNELS.uninstallHooks, async () => {
    if (!installer) throw new Error('安装器尚未初始化')
    if (!(await confirmUninstall())) return currentHookStatus()
    hookStatus = await installer.uninstall()
    broadcast()
    return hookStatus
  })

  ipcMain.handle(IPC_CHANNELS.updateSettings, async (_event, patch: unknown) =>
    updateAppSettings(patch),
  )

  ipcMain.handle(IPC_CHANNELS.hideWindow, () => {
    hideMainWindow()
  })

  ipcMain.handle(IPC_CHANNELS.testNotification, () => {
    notificationService?.test()
  })

  ipcMain.handle(
    IPC_CHANNELS.approvalDecision,
    (_event, requestId: unknown, behavior: unknown) => {
      if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 120) {
        throw new Error('无效的授权请求')
      }
      if (behavior !== 'allow' && behavior !== 'deny' && behavior !== 'fallback') {
        throw new Error('无效的授权决定')
      }
      if (!approvalCoordinator?.decide(requestId, behavior as ApprovalBehavior)) {
        throw new Error('授权请求已失效')
      }
    },
  )

  ipcMain.handle(IPC_CHANNELS.clearHistory, async () => {
    if (!persistence) throw new Error('本地存储未初始化')

    const options = {
      type: 'warning' as const,
      buttons: ['取消', '清除'],
      defaultId: 0,
      cancelId: 0,
      title: '清除历史记录',
      message: '清除所有会话历史与通知记录？',
      detail:
        '不会影响正在运行的 Claude Code。正在进行的会话可能会在再次收到事件后重新出现。',
    }
    const window = mainWindow
    const result = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options)
    if (result.response !== 1) return

    await persistence.clearHistory()
    registry.clear()
    broadcast()
  })

  ipcMain.handle(IPC_CHANNELS.quitApp, () => {
    isQuitting = true
    app.quit()
  })
}

type CliCommand = 'install-hooks' | 'uninstall-hooks' | 'diagnose'

function parseCliCommand(argv: string[]): CliCommand | null {
  const has = (name: string): boolean =>
    argv.includes(`--${name}`) || app.commandLine.hasSwitch(name)
  if (has('install-hooks')) return 'install-hooks'
  if (has('uninstall-hooks')) return 'uninstall-hooks'
  if (has('diagnose')) return 'diagnose'
  return null
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

async function runCliCommand(command: CliCommand): Promise<number> {
  const dataDir = approvalDataDir()
  await fs.mkdir(dataDir, { recursive: true })

  const installer = new HookInstaller({
    settingsPath: resolveSettingsPath(),
    relayPath: resolveRelayPath(),
    gatePath: resolveGatePath(),
    nodePath: resolveNodePath(),
    backupDir: join(app.getPath('userData'), 'backups'),
  })

  if (command !== 'diagnose') {
    const status =
      command === 'install-hooks' ? await installer.install() : await installer.uninstall()
    const result = {
      command,
      ok: !status.error,
      status,
      at: new Date().toISOString(),
    }
    await fs.writeFile(
      join(dataDir, 'cli-result.json'),
      `${JSON.stringify(result, null, 2)}\n`,
      'utf8',
    )
    console.log(JSON.stringify(result))
    return status.error ? 1 : 0
  }

  const status = await installer.status()
  const paths = {
    settingsPath: resolveSettingsPath(),
    relayPath: resolveRelayPath(),
    gatePath: resolveGatePath(),
    nodePath: resolveNodePath(),
    trayIconPath: resolveTrayIconPath(),
    spoolDir: resolveSpoolDir(),
    dataDir,
    dbPath: join(app.getPath('userData'), 'watcher.db'),
    tokenPath: join(dataDir, 'approval-token.txt'),
    sessionDir: join(homedir(), '.claude', 'sessions'),
    approvalPipe: getApprovalPipeName(),
  }

  let sessionFileCount = 0
  try {
    sessionFileCount = (await fs.readdir(paths.sessionDir)).filter((name) =>
      name.endsWith('.json'),
    ).length
  } catch {
    // no sessions yet
  }

  const diagnostics = {
    at: new Date().toISOString(),
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    paths,
    exists: {
      relay: await fileExists(paths.relayPath),
      gate: await fileExists(paths.gatePath),
      node: paths.nodePath === 'node' ? null : await fileExists(paths.nodePath),
      trayIcon: await fileExists(paths.trayIconPath),
      token: await fileExists(paths.tokenPath),
      db: await fileExists(paths.dbPath),
    },
    hooks: status,
    sessionFileCount,
  }

  await fs.writeFile(
    join(dataDir, 'diagnose.json'),
    `${JSON.stringify(diagnostics, null, 2)}\n`,
    'utf8',
  )
  console.log(JSON.stringify(diagnostics))
  return 0
}

const cliCommand = parseCliCommand(process.argv)
if (cliCommand) {
  app
    .whenReady()
    .then(async () => {
      let code = 1
      try {
        code = await runCliCommand(cliCommand)
      } catch (error) {
        const dataDir = approvalDataDir()
        try {
          await fs.mkdir(dataDir, { recursive: true })
          await fs.writeFile(
            join(dataDir, 'cli-result.json'),
            `${JSON.stringify(
              {
                command: cliCommand,
                ok: false,
                error: String(error),
                at: new Date().toISOString(),
              },
              null,
              2,
            )}\n`,
            'utf8',
          )
        } catch {
          // diagnostics are best effort
        }
        code = 1
      }
      app.exit(code)
    })
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
} else {
  const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.claudecodewatcher.app')

    settingsStore = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
    appSettings = await settingsStore.load()

    windowState = new WindowStateStore(join(app.getPath('userData'), 'window-state.json'))
    await windowState.load()

    try {
      const database = new Database(join(app.getPath('userData'), 'watcher.db'))
      persistence = new PersistenceService(
        database,
        () => registry.snapshot(),
        () => appSettings.historyRetentionDays,
        (message) => {
          if (!app.isPackaged) console.warn('[persistence]', message)
        },
      )
      await persistence.prune()
      const persistedSettings = await persistence.loadSettings()
      if (persistedSettings) {
        appSettings = persistedSettings
        await settingsStore.update(appSettings)
      } else {
        await persistence.saveSettings(appSettings)
      }
      registry.restore(await persistence.loadSessions())
      persistence.start()
    } catch (error) {
      console.warn('[persistence] init failed', String(error))
      persistence?.close()
      persistence = null
    }

    installer = new HookInstaller({
      settingsPath: resolveSettingsPath(),
      relayPath: resolveRelayPath(),
      gatePath: resolveGatePath(),
      nodePath: resolveNodePath(),
      backupDir: join(app.getPath('userData'), 'backups'),
    })
    hookStatus = await installer.status()

    approvalCoordinator = new ApprovalCoordinator({
      appDataDir: approvalDataDir(),
      getSettings: () => appSettings,
      getSessionInfo: (sessionId, cwd) => {
        const session = registry.get(sessionId)
        const resolvedCwd = session?.cwd || cwd || ''
        return {
          projectName:
            session?.projectName ??
            (resolvedCwd ? basename(resolvedCwd) : '未知目录'),
          cwd: resolvedCwd,
        }
      },
      onRequestsChanged: () => broadcast(),
      onDecision: (request, behavior) => {
        registry.resolveApproval(request.sessionId, behavior)
      },
      onAutoApproved: (sessionId, toolName) => {
        registry.recordAutoApproval(sessionId, toolName)
      },
      onRequest: (request) => {
        if (!appSettings.showOnApproval) return
        showMainWindow()
        if (!appSettings.miniMode) {
          mainWindow?.webContents.send(IPC_CHANNELS.focusSession, request.sessionId)
        }
      },
      onError: (message) => {
        if (!app.isPackaged) console.warn('[approval]', message)
      },
    })
    await approvalCoordinator.start().catch((error) => {
      console.warn('[approval] start failed', String(error))
    })

    notificationService = new NotificationService({
      getSettings: () => appSettings,
      isApprovalAvailable: () =>
        appSettings.approvalEnabled && (hookStatus?.gateInstalled ?? false),
      showWindow: showMainWindow,
      focusSession: (sessionId) => {
        void focusSessionFromNotification(sessionId)
      },
      playSound: (kind) => {
        mainWindow?.webContents.send(IPC_CHANNELS.playSound, kind)
      },
      onSent: (record) => {
        void persistence?.recordNotification(record)
      },
    })

    ingest = new HookSpoolIngest(
      resolveSpoolDir(),
      (event) => {
        registry.apply(event)
        const session = registry.get(event.sessionId)
        if (session) notificationService?.handleHookEvent(event, session)
        if (!app.isPackaged) {
          console.log(`[hook] ${event.name} ${event.sessionId.slice(0, 8)} ${event.toolName ?? ''}`)
        }
      },
      (message) => {
        console.warn('[spool]', message)
      },
    )

    registerIpc()
    createWindow()
    createTray()
    registry.subscribe(() => {
      scheduleBroadcast()
      persistence?.scheduleFlush()
    })
    await ingest.start().catch((error) => {
      console.warn('[spool] start failed', error)
    })

    sessionFileWatcher = new SessionFileWatcher(
      join(homedir(), '.claude', 'sessions'),
      (files) => {
        if (!appSettings.useSessionFileSignals) return
        for (const file of files) registry.applySessionFile(file)
      },
      (message) => {
        if (!app.isPackaged) console.warn('[session-file]', message)
      },
    )
    sessionFileWatcher.start()

    processMonitor = new ProcessMonitor({
      getSessions: () => registry.snapshot(),
      getIntervalMs: () => appSettings.pollIntervalMs,
      onAlive: (sessionId) => registry.markAlive(sessionId),
      onDead: (sessionId) => {
        const result = registry.markProcessDead(sessionId)
        if (result.abnormal) {
          const session = registry.get(sessionId)
          if (session) notificationService?.notifyAbnormal(session)
        }
      },
      onUnknown: (sessionId) => registry.markProcessUnknown(sessionId),
      onError: (message) => {
        if (!app.isPackaged) console.warn('[process]', message)
      },
    })
    processMonitor.start()

    longWaitTimer = setInterval(() => {
      notificationService?.checkLongWaiting(registry.snapshot())
    }, 60_000)

    app.on('activate', () => {
      showMainWindow()
    })
  })

  app.on('before-quit', () => {
    isQuitting = true
    ingest?.stop()
    sessionFileWatcher?.stop()
    processMonitor?.stop()
    approvalCoordinator?.stop()
    if (longWaitTimer) clearInterval(longWaitTimer)
    longWaitTimer = null
    tray?.destroy()
    tray = null
  })

  app.on('will-quit', (event) => {
    if (!persistence || quitFinalized) return
    event.preventDefault()
    quitFinalized = true
    const service = persistence
    persistence = null
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 1500))
    void Promise.race([service.flush(), timeout]).finally(() => {
      service.close()
      app.exit(0)
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && (isQuitting || !tray)) app.quit()
  })
  }
}
