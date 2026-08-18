import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

export interface TrackBaseline {
  videoTitleText: string
  videoTitles: string[]
  audioTitles: string[]
  subtitleTitles: string[]
}

export interface GeneratedNameEntry {
  originalName: string
  generatedName: string
  videoTitleText: string
  videoTitles: string[]
  audioTitles: string[]
  subtitleTitles: string[]
  encoderName: string
  // Snapshot of the generated track titles at generation time. Lives in the store (not in
  // a component) so it survives rename re-keying and remounts — drives dirty/Clear state.
  baseline: TrackBaseline
}

function emptyBaseline(): TrackBaseline {
  return {
    videoTitleText: '',
    videoTitles: [],
    audioTitles: [],
    subtitleTitles: [],
  }
}

function emptyEntry(originalName: string): GeneratedNameEntry {
  return {
    originalName,
    generatedName: '',
    videoTitleText: '',
    videoTitles: [],
    audioTitles: [],
    subtitleTitles: [],
    encoderName: '',
    baseline: emptyBaseline(),
  }
}

interface GeneratedNamesState {
  entries: Record<string, GeneratedNameEntry>
  ensureOriginal: (originalName: string) => void
  setGeneratedName: (originalName: string, generatedName: string) => void
  setGeneratedTracks: (
    originalName: string,
    tracks: Pick<
      GeneratedNameEntry,
      | 'videoTitleText'
      | 'videoTitles'
      | 'audioTitles'
      | 'subtitleTitles'
      | 'encoderName'
    >
  ) => void
  setVideoTitleText: (originalName: string, title: string) => void
  setVideoTitleAtIndex: (
    originalName: string,
    index: number,
    title: string
  ) => void
  setAudioTitleAtIndex: (
    originalName: string,
    index: number,
    title: string
  ) => void
  setSubtitleTitleAtIndex: (
    originalName: string,
    index: number,
    title: string
  ) => void
  setEncoderName: (originalName: string, encoderName: string) => void
  renameOriginal: (oldName: string, newName: string) => void
  removeOriginal: (originalName: string) => void
  clear: () => void
}

export const useGeneratedNamesStore = create<GeneratedNamesState>()(
  devtools(
    set => {
      // Patch an entry, preserving every field (including baseline) not in the patch.
      const patchEntry = (
        state: GeneratedNamesState,
        originalName: string,
        patch: Partial<GeneratedNameEntry>
      ): Partial<GeneratedNamesState> => {
        const current = state.entries[originalName] ?? emptyEntry(originalName)
        return {
          entries: {
            ...state.entries,
            [originalName]: { ...current, ...patch, originalName },
          },
        }
      }

      return {
        entries: {},

        ensureOriginal: originalName =>
          set(
            state =>
              state.entries[originalName]
                ? state
                : {
                    entries: {
                      ...state.entries,
                      [originalName]: emptyEntry(originalName),
                    },
                  },
            undefined,
            'ensureOriginal'
          ),

        setGeneratedName: (originalName, generatedName) =>
          set(
            state => patchEntry(state, originalName, { generatedName }),
            undefined,
            'setGeneratedName'
          ),

        setGeneratedTracks: (originalName, tracks) =>
          set(
            state =>
              patchEntry(state, originalName, {
                ...tracks,
                // The freshly generated values become the dirty-tracking baseline.
                baseline: {
                  videoTitleText: tracks.videoTitleText,
                  videoTitles: [...tracks.videoTitles],
                  audioTitles: [...tracks.audioTitles],
                  subtitleTitles: [...tracks.subtitleTitles],
                },
              }),
            undefined,
            'setGeneratedTracks'
          ),

        setVideoTitleText: (originalName, title) =>
          set(
            state => patchEntry(state, originalName, { videoTitleText: title }),
            undefined,
            'setVideoTitleText'
          ),

        setVideoTitleAtIndex: (originalName, index, title) =>
          set(
            state => {
              const entry = state.entries[originalName]
              if (!entry || index < 0 || index >= entry.videoTitles.length)
                return state
              const videoTitles = [...entry.videoTitles]
              videoTitles[index] = title
              return patchEntry(state, originalName, { videoTitles })
            },
            undefined,
            'setVideoTitleAtIndex'
          ),

        setAudioTitleAtIndex: (originalName, index, title) =>
          set(
            state => {
              const entry = state.entries[originalName]
              if (!entry || index < 0 || index >= entry.audioTitles.length)
                return state
              const audioTitles = [...entry.audioTitles]
              audioTitles[index] = title
              return patchEntry(state, originalName, { audioTitles })
            },
            undefined,
            'setAudioTitleAtIndex'
          ),

        setSubtitleTitleAtIndex: (originalName, index, title) =>
          set(
            state => {
              const entry = state.entries[originalName]
              if (!entry || index < 0 || index >= entry.subtitleTitles.length)
                return state
              const subtitleTitles = [...entry.subtitleTitles]
              subtitleTitles[index] = title
              return patchEntry(state, originalName, { subtitleTitles })
            },
            undefined,
            'setSubtitleTitleAtIndex'
          ),

        setEncoderName: (originalName, encoderName) =>
          set(
            state => patchEntry(state, originalName, { encoderName }),
            undefined,
            'setEncoderName'
          ),

        renameOriginal: (oldName, newName) =>
          set(
            state => {
              const existing = state.entries[oldName]
              if (!existing) return state
              const { [oldName]: _removed, ...rest } = state.entries
              return {
                entries: {
                  ...rest,
                  [newName]: { ...existing, originalName: newName },
                },
              }
            },
            undefined,
            'renameOriginal'
          ),

        removeOriginal: originalName =>
          set(
            state => {
              if (!state.entries[originalName]) return state
              const { [originalName]: _removed, ...rest } = state.entries
              return { entries: rest }
            },
            undefined,
            'removeOriginal'
          ),

        clear: () => set({ entries: {} }, undefined, 'clear'),
      }
    },
    { name: 'generated-names' }
  )
)
