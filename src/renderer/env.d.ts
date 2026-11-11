import type { WatcherApi } from '@shared/ipc'

declare global {
  interface Window {
    watcher?: WatcherApi
  }
}

export {}
