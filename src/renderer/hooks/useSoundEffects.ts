import { useEffect } from 'react'
import { playSound } from '@renderer/lib/sound'
import { useWatcherStore } from '@renderer/stores/watcher'

export function useSoundEffects(): void {
  useEffect(() => {
    const api = window.watcher
    if (!api) return
    return api.onPlaySound((kind) => {
      if (useWatcherStore.getState().snapshot?.settings.soundEnabled) {
        playSound(kind)
      }
    })
  }, [])
}
