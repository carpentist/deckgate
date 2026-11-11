import { create } from 'zustand'
import type { WatcherSnapshot } from '@shared/types/session'

export type SessionFilter = 'all' | 'running' | 'waiting' | 'completed' | 'error'
export type SortMode = 'activity' | 'started' | 'status'
export type ViewMode = 'list' | 'detail' | 'settings'

interface WatcherState {
  snapshot: WatcherSnapshot | null
  selectedSessionId: string | null
  view: ViewMode
  query: string
  filter: SessionFilter
  sort: SortMode
  setSnapshot: (snapshot: WatcherSnapshot) => void
  openSession: (sessionId: string) => void
  setView: (view: ViewMode) => void
  backToList: () => void
  setQuery: (query: string) => void
  setFilter: (filter: SessionFilter) => void
  setSort: (sort: SortMode) => void
}

export const useWatcherStore = create<WatcherState>((set) => ({
  snapshot: null,
  selectedSessionId: null,
  view: 'list',
  query: '',
  filter: 'all',
  sort: 'activity',
  setSnapshot: (snapshot) =>
    set((state) => {
      const current = state.selectedSessionId
      const stillExists = current
        ? snapshot.sessions.some((session) => session.sessionId === current)
        : false
      if (state.view === 'detail' && !stillExists) {
        return { snapshot, selectedSessionId: null, view: 'list' }
      }
      return {
        snapshot,
        selectedSessionId: stillExists ? current : null,
      }
    }),
  openSession: (sessionId) => set({ selectedSessionId: sessionId, view: 'detail' }),
  setView: (view) => set({ view }),
  backToList: () => set({ view: 'list' }),
  setQuery: (query) => set({ query }),
  setFilter: (filter) => set({ filter }),
  setSort: (sort) => set({ sort }),
}))
