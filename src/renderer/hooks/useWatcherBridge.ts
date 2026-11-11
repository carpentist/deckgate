import { useEffect, useState } from 'react'
import { useWatcherStore } from '@renderer/stores/watcher'

export function useWatcherBridge(): { connectionError: string | null } {
  const setSnapshot = useWatcherStore((state) => state.setSnapshot)
  const [connectionError, setConnectionError] = useState<string | null>(null)

  useEffect(() => {
    const api = window.watcher
    if (!api) {
      setConnectionError('无法连接主进程（preload 未加载）')
      return
    }

    let active = true

    api
      .getSnapshot()
      .then((snapshot) => {
        if (!active) return
        setConnectionError(null)
        setSnapshot(snapshot)
      })
      .catch((error: unknown) => {
        if (!active) return
        setConnectionError(error instanceof Error ? error.message : String(error))
      })

    const unsubscribe = api.onSessionsUpdated((snapshot) => {
      if (active) setSnapshot(snapshot)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [setSnapshot])

  return { connectionError }
}
