import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { readDir } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { useLocalUploadQueue } from '@/store/local-upload-queue-store'
import { Input } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import { useGeneratedNamesStore } from '@/store/generated-names-store'
import { ActionBar } from '@/components/upload/ActionBar'
import { FileVideo, X } from 'lucide-react'
import {
  getFileName,
  getPathExtension,
  stripExtensionFromName,
} from '@/lib/naming'
import { useQueueActions } from '@/components/upload/useQueueActions'

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

interface BrowseLocalFilesProps {
  showActionBar?: boolean
  variant?: 'default' | 'queue'
}

export function BrowseLocalFiles({
  showActionBar = true,
  variant = 'default',
}: BrowseLocalFilesProps) {
  const { items, remove } = useLocalUploadQueue()
  const { entries, ensureOriginal, setGeneratedName } = useGeneratedNamesStore()
  const {
    isBrowsing,
    isRenaming,
    isRetagging,
    hasItems,
    handleBrowse,
    handleClear,
    handleGenerate,
    handleRetag,
    handleRenameAll,
  } = useQueueActions()
  const [isDropActive, setIsDropActive] = useState(false)

  useEffect(() => {
    let unlisten: (() => void) | null = null

    const setup = async () => {
      try {
        const win = getCurrentWindow()
        unlisten = await win.onDragDropEvent(async ({ payload }) => {
          switch (payload.type) {
            case 'enter':
            case 'over':
              setIsDropActive(true)
              break
            case 'leave':
              setIsDropActive(false)
              break
            case 'drop': {
              setIsDropActive(false)
              const paths = payload.paths ?? []
              if (paths.length === 0) return

              const existing = new Set(
                useLocalUploadQueue.getState().items.map(i => i.path)
              )

              interface ClassifiedPath {
                path: string
                kind: 'file' | 'folder'
              }

              try {
                const classified = await invoke<ClassifiedPath[]>(
                  'classify_paths',
                  { paths }
                )

                const filePaths: string[] = []
                for (const item of classified) {
                  if (item.kind === 'folder') {
                    const folderFiles = await listFilesInFolder(item.path)
                    filePaths.push(...folderFiles)
                  } else {
                    filePaths.push(item.path)
                  }
                }
                useLocalUploadQueue.getState().addFiles(filePaths)

                const addedCount = filePaths.filter(
                  path => !existing.has(path)
                ).length
                if (addedCount > 0) {
                  toast.success(`Added ${addedCount} items to queue`)
                }
              } catch (error) {
                logger.warn(
                  'Failed to classify dropped paths, defaulting to file',
                  {
                    error: String(error),
                  }
                )
                const fallbackFiles: string[] = []
                for (const path of paths) {
                  try {
                    const folderFiles = await listFilesInFolder(path)
                    if (folderFiles.length > 0) {
                      fallbackFiles.push(...folderFiles)
                      continue
                    }
                  } catch {
                    // Not a folder or not readable, treat as file.
                  }
                  fallbackFiles.push(path)
                }

                useLocalUploadQueue.getState().addFiles(fallbackFiles)

                const addedCount = fallbackFiles.filter(
                  path => !existing.has(path)
                ).length
                if (addedCount > 0) {
                  toast.success(`Added ${addedCount} items to queue`)
                }
              }
              break
            }
          }
        })
      } catch (error) {
        logger.debug('Tauri drag-and-drop events not available', {
          error: String(error),
        })
      }
    }

    setup()
    return () => {
      if (unlisten) unlisten()
    }
  }, [])

  useEffect(() => {
    items.forEach(item => {
      ensureOriginal(item.path)
    })
  }, [items, ensureOriginal])

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col gap-4 overflow-hidden',
        isDropActive ? 'rounded-md ring-2 ring-emerald-400/60' : null
      )}
    >
      {variant !== 'queue' ? (
        <div>
          <h2 className="text-sm font-semibold text-foreground">Browse</h2>
          <p className="text-xs text-muted-foreground">
            Add files or folders to the queue.
          </p>
        </div>
      ) : null}
      {showActionBar ? (
        <ActionBar
          isBrowsing={isBrowsing}
          isRenaming={isRenaming}
          isRetagging={isRetagging}
          hasItems={hasItems}
          onBrowse={handleBrowse}
          onClear={handleClear}
          onGenerate={handleGenerate}
          onRetag={handleRetag}
          onRenameAll={handleRenameAll}
        />
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-1">
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Drop files here or use Browse to add items.
          </div>
        ) : (
          <div
            className={cn(
              'flex flex-col gap-2',
              variant === 'queue' && 'gap-1'
            )}
          >
            {items.map(item => {
              if (variant === 'queue') {
                return (
                  <div
                    key={item.id}
                    className="group relative flex w-full items-center gap-2 rounded-md px-2.5 py-2.5 text-left transition hover:bg-muted/30"
                  >
                    <div className="text-secondary-foreground/80">
                      <FileVideo className="h-4 w-4" />
                    </div>
                    <Tooltip delayDuration={300}>
                      <TooltipTrigger asChild>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-foreground leading-5">
                            {getFileName(item.path)}
                          </p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>{getFileName(item.path)}</TooltipContent>
                    </Tooltip>
                    <button
                      type="button"
                      onClick={event => {
                        event.stopPropagation()
                        remove(item.path)
                      }}
                      className="rounded-sm p-1 text-muted-foreground/40 transition group-hover:text-muted-foreground hover:text-foreground"
                      aria-label="Remove from queue"
                      title="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )
              }

              return (
                <div key={item.id} className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {getFileName(item.path)}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Input
                      value={entries[item.path]?.generatedName ?? ''}
                      onChange={event => {
                        const extension = getPathExtension(item.path)
                        const nextValue = stripExtensionFromName(
                          event.target.value,
                          extension
                        )
                        setGeneratedName(item.path, nextValue)
                      }}
                      placeholder="Enter generated name"
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
