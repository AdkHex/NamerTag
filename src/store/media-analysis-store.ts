import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import type { MediaAnalysis } from '@/types/media-analysis'

interface MediaAnalysisState {
  analysesByPath: Record<string, MediaAnalysis>
  loading: boolean
  error: string | null
  loadAnalyses: (paths: string[]) => Promise<void>
  setAnalyses: (analyses: MediaAnalysis[]) => void
  renamePath: (oldPath: string, newPath: string) => void
  clear: () => void
}

export const useMediaAnalysisStore = create<MediaAnalysisState>((set, get) => ({
  analysesByPath: {},
  loading: false,
  error: null,
  loadAnalyses: async paths => {
    if (paths.length === 0) {
      set({ analysesByPath: {}, loading: false, error: null })
      return
    }
    const existing = get().analysesByPath
    // Prune analyses for paths no longer in the queue.
    const pruned: Record<string, MediaAnalysis> = {}
    paths.forEach(p => {
      if (existing[p]) pruned[p] = existing[p]
    })
    // Only probe paths we don't already have — never overwrite analyses that a prior
    // Generate already produced (which carry the derived fields the names depend on).
    const missing = paths.filter(p => !existing[p])
    if (missing.length === 0) {
      set({ analysesByPath: pruned, loading: false, error: null })
      return
    }
    set({ analysesByPath: pruned, loading: true, error: null })
    try {
      const results = await invoke<MediaAnalysis[]>('list_media_streams', {
        paths: missing,
      })
      const next = { ...get().analysesByPath }
      results.forEach(result => {
        const key =
          result.general.file.path || result.general.file.filename || ''
        if (key) next[key] = result
      })
      set({ analysesByPath: next, loading: false, error: null })
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },
  setAnalyses: analyses => {
    // Merge into existing rather than replacing, so a concurrent loadAnalyses cannot wipe
    // freshly generated analyses (and vice versa).
    const next = { ...get().analysesByPath }
    analyses.forEach(result => {
      const key = result.general.file.path || result.general.file.filename || ''
      if (key) next[key] = result
    })
    set({ analysesByPath: next, loading: false, error: null })
  },
  renamePath: (oldPath, newPath) =>
    set(state => {
      const existing = state.analysesByPath[oldPath]
      if (!existing) return state
      const { [oldPath]: _removed, ...rest } = state.analysesByPath
      return {
        ...state,
        analysesByPath: {
          ...rest,
          [newPath]: {
            ...existing,
            general: {
              ...existing.general,
              file: {
                ...existing.general.file,
                path: newPath,
                filename: newPath.split(/[/\\\\]/).pop() ?? newPath,
              },
            },
          },
        },
      }
    }),
  clear: () => set({ analysesByPath: {}, loading: false, error: null }),
}))
