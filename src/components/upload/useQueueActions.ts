import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { readDir } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { useLocalUploadQueue } from '@/store/local-upload-queue-store'
import { useGeneratedNamesStore } from '@/store/generated-names-store'
import { useMediaAnalysisStore } from '@/store/media-analysis-store'
import { useRenameLogStore, type RenamePair } from '@/store/rename-log-store'
import { usePreferences } from '@/services/preferences'
import type { MediaAnalysis } from '@/types/media-analysis'
import {
  buildGeneratedNameDraft,
  buildRenameTargetPath,
  getFileName,
  type GeneratedNameDraft,
} from '@/lib/naming'

function normalizeSelection(
  selection: string | string[] | null
): string[] | null {
  if (selection === null) return null
  return Array.isArray(selection) ? selection : [selection]
}

async function listFilesInFolder(folderPath: string): Promise<string[]> {
  const entries = await readDir(folderPath)
  const files: string[] = []
  for (const entry of entries) {
    const entryPath = await join(folderPath, entry.name)
    if (entry.isDirectory) {
      const nested = await listFilesInFolder(entryPath)
      files.push(...nested)
    } else if (entry.isFile) {
      files.push(entryPath)
    }
  }
  return files
}

export function useQueueActions() {
  const { items, addFiles, clear, updateItemPath } = useLocalUploadQueue()
  const setItemStatus = useLocalUploadQueue(s => s.setItemStatus)
  const { entries, setGeneratedName, renameOriginal } = useGeneratedNamesStore()
  const setGeneratedTracks = useGeneratedNamesStore(s => s.setGeneratedTracks)
  const { data: preferences } = usePreferences()
  const setAnalyses = useMediaAnalysisStore(s => s.setAnalyses)
  const renameAnalysisPath = useMediaAnalysisStore(s => s.renamePath)
  const analysesByPath = useMediaAnalysisStore(s => s.analysesByPath)
  const pushRenameBatch = useRenameLogStore(s => s.pushBatch)
  const popRenameBatch = useRenameLogStore(s => s.popBatch)
  const renameBatches = useRenameLogStore(s => s.batches)
  const [isBrowsing, setIsBrowsing] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [isRetagging, setIsRetagging] = useState(false)
  const [retaggingPath, setRetaggingPath] = useState<string | null>(null)
  const [retagStatus, setRetagStatus] = useState<'success' | 'error' | null>(
    null
  )

  const handleAddFiles = async () => {
    if (isBrowsing) return
    setIsBrowsing(true)
    try {
      const filesSelection = await open({
        multiple: true,
        directory: false,
        title: 'Select files',
      })
      const files = normalizeSelection(filesSelection) ?? []
      if (files.length > 0) addFiles(files)
    } finally {
      setIsBrowsing(false)
    }
  }

  const handleAddFolder = async () => {
    if (isBrowsing) return
    setIsBrowsing(true)
    try {
      const foldersSelection = await open({
        multiple: false,
        directory: true,
        title: 'Select folder',
      })
      const folders = normalizeSelection(foldersSelection) ?? []
      const [firstFolder] = folders
      if (firstFolder) {
        const folderFiles = await listFilesInFolder(firstFolder)
        if (folderFiles.length > 0) {
          addFiles(folderFiles)
        }
      }
    } finally {
      setIsBrowsing(false)
    }
  }

  const handleBrowse = async () => {
    await handleAddFiles()
    await handleAddFolder()
  }

  const handleGenerate = async (): Promise<GeneratedNameDraft[]> => {
    if (items.length === 0) return []
    try {
      const results = await invoke<MediaAnalysis[]>('list_media_streams', {
        paths: items.map(item => item.path),
      })
      setAnalyses(results)
      const drafts = results.map(result =>
        buildGeneratedNameDraft(result, preferences)
      )
      drafts.forEach(draft => {
        setGeneratedTracks(draft.path, {
          videoTitleText: draft.videoTitleText,
          videoTitles: draft.videoTitles,
          audioTitles: draft.audioTitles,
          subtitleTitles: draft.subtitleTitles,
          encoderName: draft.encoderName,
        })
        if (draft.generatedName) {
          setGeneratedName(draft.path, draft.generatedName)
        }
      })
      return drafts
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error('Failed to generate track titles', {
        description: message,
      })
      return []
    }
  }

  const handleRetag = async () => {
    if (items.length === 0) return
    if (isRetagging) return
    setIsRetagging(true)
    setRetagStatus(null)
    let updatedCount = 0
    const retagRequests: {
      path: string
      containerTitle: string
      videoTitles: string[]
      audioTitles: string[]
      subtitleTitles: string[]
      videoStreamIndexes: number[]
      audioStreamIndexes: number[]
      subtitleStreamIndexes: number[]
    }[] = []

    try {
      items.forEach(item => {
        const entry = entries[item.path]
        if (!entry) return
        const hasTitles =
          Boolean(entry.videoTitleText) ||
          entry.videoTitles.length > 0 ||
          entry.audioTitles.length > 0 ||
          entry.subtitleTitles.length > 0
        if (!hasTitles) return
        // Guard against stale caches mislabeling tracks: the per-stream title arrays must
        // match the current stream counts. Empty titles are dropped server-side so they
        // never clobber existing metadata.
        const analysis = analysesByPath[item.path]
        if (analysis) {
          const videoMismatch =
            entry.videoTitles.length > 0 &&
            entry.videoTitles.length !== analysis.video.length
          const audioMismatch =
            entry.audioTitles.length > 0 &&
            entry.audioTitles.length !== analysis.audio.length
          const subtitleMismatch =
            entry.subtitleTitles.length > 0 &&
            entry.subtitleTitles.length !== analysis.subtitles.length
          if (videoMismatch || audioMismatch || subtitleMismatch) {
            toast.error(`Skipped ${getFileName(item.path)}`, {
              description:
                'Track titles are out of sync with the file. Re-generate before retagging.',
            })
            return
          }
        }
        // Address tracks by their real ffprobe stream index. The analyzer skips cover-art
        // streams, so a positional selector would write the video title onto a poster that
        // was muxed ahead of the real video track.
        retagRequests.push({
          path: item.path,
          containerTitle: entry.videoTitleText,
          videoTitles: entry.videoTitles,
          audioTitles: entry.audioTitles,
          subtitleTitles: entry.subtitleTitles,
          videoStreamIndexes: (analysis?.video ?? []).map(s => s.stream_index),
          audioStreamIndexes: (analysis?.audio ?? []).map(s => s.stream_index),
          subtitleStreamIndexes: (analysis?.subtitles ?? []).map(
            s => s.stream_index
          ),
        })
        updatedCount += 1
      })

      if (updatedCount === 0) {
        toast.error('No cached media info', {
          description: 'Generate titles first or edit them before retagging.',
        })
        return
      }

      const results: {
        path: string
        success: boolean
        error?: string | null
      }[] = []
      for (const request of retagRequests) {
        setRetaggingPath(request.path)
        try {
          const response = await invoke<
            { path: string; success: boolean; error?: string | null }[]
          >('retag_media_files', { items: [request] })
          const first = response[0]
          if (first) {
            results.push(first)
          } else {
            results.push({
              path: request.path,
              success: false,
              error: 'No result returned',
            })
          }
        } catch (error) {
          results.push({
            path: request.path,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      const failed = results.filter(result => !result.success)
      if (failed.length === 0) {
        toast.success(`Retagged ${results.length} files`)
      } else {
        toast.error(`Failed to retag ${failed.length} files`)
      }
      const status = failed.length === 0 ? 'success' : 'error'
      setRetagStatus(status)
      setTimeout(() => {
        setRetagStatus(null)
      }, 1200)
    } finally {
      setRetaggingPath(null)
      setIsRetagging(false)
    }
  }

  const handleRenameAll = async () => {
    if (isRenaming || items.length === 0) return
    setIsRenaming(true)
    const renamed: string[] = []
    const renamedPairs: RenamePair[] = []
    const failed: string[] = []
    const failedDetails: { from: string; to: string; error: string }[] = []
    const idByPath = new Map(items.map(item => [item.path, item.id]))
    const markFailed = (path: string, target: string, error: string) => {
      failed.push(path)
      failedDetails.push({ from: path, to: target, error })
      const id = idByPath.get(path)
      if (id) setItemStatus(id, 'failed', error)
    }
    try {
      // Pre-pass: compute every target up front and detect duplicate targets within the
      // batch (case-insensitively) so we never let one item overwrite another.
      const planned: { path: string; target: string }[] = []
      const targetCounts = new Map<string, number>()
      for (const item of items) {
        const entry = entries[item.path]
        const nextName = entry?.generatedName?.trim()
        if (!nextName) continue
        let target: string
        try {
          target = buildRenameTargetPath(item.path, nextName)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          markFailed(item.path, nextName, message)
          continue
        }
        if (target === item.path) continue
        planned.push({ path: item.path, target })
        const key = target.toLowerCase()
        targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1)
      }

      for (const { path, target } of planned) {
        if ((targetCounts.get(target.toLowerCase()) ?? 0) > 1) {
          markFailed(
            path,
            target,
            'Two files in this batch produce the same name — skipped to avoid overwriting.'
          )
          continue
        }
        try {
          logger.info('Renaming file', { from: path, to: target })
          // safe_rename never overwrites the destination (closes the exists()/rename race).
          await invoke('safe_rename', { from: path, to: target })
          updateItemPath(path, target)
          renameOriginal(path, target)
          renameAnalysisPath(path, target)
          renamed.push(target)
          renamedPairs.push({ from: path, to: target })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          logger.warn('Failed to rename file', {
            error: message,
            from: path,
            to: target,
          })
          markFailed(path, target, message)
        }
      }
      if (renamedPairs.length > 0) pushRenameBatch(renamedPairs)
    } finally {
      setIsRenaming(false)
      if (renamed.length > 0) {
        toast.success(`Renamed ${renamed.length} files`)
      }
      if (failed.length > 0) {
        toast.error(`Failed to rename ${failed.length} files`, {
          description: failedDetails[0]?.error,
        })
      }
    }
  }

  const handleUndoRename = async () => {
    if (isRenaming) return
    const batch = popRenameBatch()
    if (!batch) return
    setIsRenaming(true)
    let undone = 0
    let firstError: string | null = null
    try {
      // Reverse within the batch so dependent renames unwind safely.
      for (const pair of [...batch.pairs].reverse()) {
        try {
          await invoke('safe_rename', { from: pair.to, to: pair.from })
          updateItemPath(pair.to, pair.from)
          renameOriginal(pair.to, pair.from)
          renameAnalysisPath(pair.to, pair.from)
          undone += 1
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          firstError = firstError ?? message
          logger.warn('Failed to undo rename', {
            error: message,
            from: pair.to,
            to: pair.from,
          })
        }
      }
    } finally {
      setIsRenaming(false)
      if (undone > 0) toast.success(`Reverted ${undone} rename(s)`)
      if (firstError) {
        toast.error('Some renames could not be reverted', {
          description: firstError,
        })
      }
    }
  }

  return {
    isBrowsing,
    isRenaming,
    isRetagging,
    retaggingPath,
    retagStatus,
    hasItems: items.length > 0,
    canUndoRename: renameBatches.length > 0,
    handleAddFiles,
    handleAddFolder,
    handleBrowse,
    handleClear: clear,
    handleGenerate,
    handleRetag,
    handleRenameAll,
    handleUndoRename,
  }
}
