import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type WatcherApi } from '@shared/ipc'
import type { AppSettings, SoundKind } from '@shared/types/settings'
import type { WatcherSnapshot } from '@shared/types/session'

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: T): void => listener(value)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: WatcherApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getSnapshot),
  refresh: () => ipcRenderer.invoke(IPC_CHANNELS.refresh),
  onSessionsUpdated: (listener) =>
    subscribe<WatcherSnapshot>(IPC_CHANNELS.sessionsUpdated, listener),
  copyText: (text) => ipcRenderer.invoke(IPC_CHANNELS.copyText, text),
  openPath: (target) => ipcRenderer.invoke(IPC_CHANNELS.openPath, target),
  getHookStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getHookStatus),
  installHooks: () => ipcRenderer.invoke(IPC_CHANNELS.installHooks),
  uninstallHooks: () => ipcRenderer.invoke(IPC_CHANNELS.uninstallHooks),
  updateSettings: (patch: Partial<AppSettings>) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateSettings, patch),
  hideWindow: () => ipcRenderer.invoke(IPC_CHANNELS.hideWindow),
  onPlaySound: (listener) => subscribe<SoundKind>(IPC_CHANNELS.playSound, listener),
  onFocusSession: (listener) => subscribe<string>(IPC_CHANNELS.focusSession, listener),
  testNotification: () => ipcRenderer.invoke(IPC_CHANNELS.testNotification),
  approvalDecision: (requestId, behavior) =>
    ipcRenderer.invoke(IPC_CHANNELS.approvalDecision, requestId, behavior),
  clearHistory: () => ipcRenderer.invoke(IPC_CHANNELS.clearHistory),
  quitApp: () => ipcRenderer.invoke(IPC_CHANNELS.quitApp),
}

contextBridge.exposeInMainWorld('watcher', api)
