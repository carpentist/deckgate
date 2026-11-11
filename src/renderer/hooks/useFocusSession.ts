import { useEffect } from 'react'
import { useWatcherStore } from '@renderer/stores/watcher'

export function useFocusSession(): void {
  useEffect(() => {
    const api = window.watcher
    if (!api) return
    return api.onFocusSession((sessionId) => {
      useWatcherStore.getState().openSession(sessionId)
    })
  }, [])
}
