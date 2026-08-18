import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

export interface RenamePair {
  from: string
  to: string
}

export interface RenameBatch {
  at: number
  pairs: RenamePair[]
}

interface RenameLogState {
  // Most recent batch is last. Each batch is one "Rename all" invocation.
  batches: RenameBatch[]
  pushBatch: (pairs: RenamePair[]) => void
  popBatch: () => RenameBatch | undefined
  clear: () => void
}

const MAX_BATCHES = 20

export const useRenameLogStore = create<RenameLogState>()(
  devtools(
    (set, get) => ({
      batches: [],

      pushBatch: pairs =>
        set(
          state => {
            if (pairs.length === 0) return state
            const next = [...state.batches, { at: Date.now(), pairs }]
            // Bound the history so it can't grow without limit.
            return { batches: next.slice(-MAX_BATCHES) }
          },
          undefined,
          'pushBatch'
        ),

      popBatch: () => {
        const { batches } = get()
        const last = batches[batches.length - 1]
        if (!last) return undefined
        set({ batches: batches.slice(0, -1) }, undefined, 'popBatch')
        return last
      },

      clear: () => set({ batches: [] }, undefined, 'clear'),
    }),
    { name: 'rename-log' }
  )
)
