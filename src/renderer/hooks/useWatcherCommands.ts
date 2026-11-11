import { useCallback, useState } from 'react'
import type { AppSettings } from '@shared/types/settings'
import { useWatcherStore } from '@renderer/stores/watcher'

type BusyAction = 'refresh' | 'install' | 'uninstall'

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+':\s*/, '')
}

export function useWatcherCommands(): {
  busy: BusyAction | null
  error: string | null
  clearError: () => void
  refresh: () => Promise<void>
  install: () => Promise<void>
  uninstall: () => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  hideWindow: () => Promise<void>
  clearHistory: () => Promise<void>
} {
  const setSnapshot = useWatcherStore((state) => state.setSnapshot)
  const [busy, setBusy] = useState<BusyAction | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const api = window.watcher
    if (!api) {
      setError('无法连接主进程')
      return
    }
    setBusy('refresh')
    try {
      setSnapshot(await api.refresh())
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setBusy(null)
    }
  }, [setSnapshot])

  const install = useCallback(async () => {
    const api = window.watcher
    if (!api) {
      setError('无法连接主进程')
      return
    }
    setBusy('install')
    try {
      const status = await api.installHooks()
      setSnapshot(await api.getSnapshot())
      if (status.error) setError(status.error)
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setBusy(null)
    }
  }, [setSnapshot])

  const uninstall = useCallback(async () => {
    const api = window.watcher
    if (!api) {
      setError('无法连接主进程')
      return
    }
    setBusy('uninstall')
    try {
      const status = await api.uninstallHooks()
      setSnapshot(await api.getSnapshot())
      if (status.error) setError(status.error)
    } catch (cause) {
      setError(describeError(cause))
    } finally {
      setBusy(null)
    }
  }, [setSnapshot])

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const api = window.watcher
      if (!api) {
        setError('无法连接主进程')
        return
      }
      try {
        setSnapshot(await api.updateSettings(patch))
      } catch (cause) {
        setError(describeError(cause))
      }
    },
    [setSnapshot],
  )

  const hideWindow = useCallback(async () => {
    try {
      await window.watcher?.hideWindow()
    } catch (cause) {
      setError(describeError(cause))
    }
  }, [])

  const clearHistory = useCallback(async () => {
    const api = window.watcher
    if (!api) {
      setError('无法连接主进程')
      return
    }
    try {
      await api.clearHistory()
      setSnapshot(await api.getSnapshot())
    } catch (cause) {
      setError(describeError(cause))
    }
  }, [setSnapshot])

  return {
    busy,
    error,
    clearError: () => setError(null),
    refresh,
    install,
    uninstall,
    updateSettings,
    hideWindow,
    clearHistory,
  }
}
