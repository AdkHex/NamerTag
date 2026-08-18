import { useMemo } from 'react'
import { useLocalUploadQueue } from '@/store/local-upload-queue-store'
import { useGeneratedNamesStore } from '@/store/generated-names-store'
import { useMediaAnalysisStore } from '@/store/media-analysis-store'
import {
  collectNamingWarnings,
  previewTokens,
  type NamingOptions,
} from '@/lib/naming-engine'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { BatchRenameTools } from '@/components/media/BatchRenameTools'
import { ExtraActionsPanel } from '@/components/media/ExtraActionsPanel'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { usePreferences, useSavePreferences } from '@/services/preferences'
import { useQueueActions } from '@/components/upload/useQueueActions'
import {
  buildGeneratedNameDraft,
  getFileName,
  getPathExtension,
  stripExtensionFromName,
} from '@/lib/naming'
import type { AppPreferences } from '@/types/preferences'

function buildGeneratedFileName(value: string, extension: string) {
  const base = stripExtensionFromName(value, extension)
  if (!base) return ''
  return extension ? `${base}.${extension}` : base
}

export function GeneratedFilenamesPanel() {
  const items = useLocalUploadQueue(s => s.items)
  const entries = useGeneratedNamesStore(s => s.entries)
  const setGeneratedName = useGeneratedNamesStore(s => s.setGeneratedName)
  const { data: preferences } = usePreferences()
  const savePreferences = useSavePreferences()
  const {
    isRenaming,
    hasItems,
    canUndoRename,
    handleGenerate,
    handleRenameAll,
    handleUndoRename,
  } = useQueueActions()

  const analysesByPath = useMediaAnalysisStore(s => s.analysesByPath)

  // Naming mode + Filename tag (the muxed suffix) are the per-batch choices here; source
  // and group are auto-detected (override print type on the Track Titles tab).
  const tags = preferences?.tags ?? []
  const printType =
    (preferences?.printTypeOverride as 'BluRay' | 'WEB-DL' | '') || ''
  const namingMode = preferences?.namingMode || 'auto'
  const removeYear = preferences?.removeYear ?? false
  const filenameTag = preferences?.filenameTag || '__none__'
  // The selected Filename tag is the muxed suffix; fall back to the default suffix pref.
  const muxedSuffix =
    preferences?.filenameTag?.trim() ||
    preferences?.ionicSuffix?.trim() ||
    'Ionicboy'

  const rows = useMemo(() => {
    const options: NamingOptions = {
      mode: namingMode,
      printTypeOverride: printType,
      group: preferences?.encoderName?.trim() || undefined,
      ionicSuffix: muxedSuffix,
      removeYear,
      languagePriority: preferences?.languagePriority,
      videoCodecOverrides: preferences?.videoCodecOverrides,
      audioCodecOverrides: preferences?.audioCodecOverrides,
      languageOverrides: preferences?.languageOverrides,
    }
    return items.map(item => {
      const analysis = analysesByPath[item.path]
      return {
        path: item.path,
        fileName: getFileName(item.path),
        extension: getPathExtension(item.path),
        generatedName: entries[item.path]?.generatedName ?? '',
        generatedFileName: buildGeneratedFileName(
          entries[item.path]?.generatedName ?? '',
          getPathExtension(item.path)
        ),
        warnings: analysis ? collectNamingWarnings(analysis, options) : [],
        tokens: analysis ? previewTokens(analysis, options) : [],
      }
    })
  }, [
    analysesByPath,
    entries,
    items,
    namingMode,
    printType,
    muxedSuffix,
    removeYear,
    preferences,
  ])

  // Re-derive the on-disk names from the already-analysed media whenever a generation control
  // (naming mode / filename tag / remove year) changes, so the change is reflected live without
  // a second "Generate" click. No-ops cleanly when nothing has been analysed yet, and leaves
  // the track titles on the other tab untouched.
  const regenerateFromCache = (overrides: Partial<AppPreferences>) => {
    if (!preferences) return
    const merged = { ...preferences, ...overrides }
    const { setGeneratedName } = useGeneratedNamesStore.getState()
    for (const item of items) {
      const analysis = analysesByPath[item.path]
      if (!analysis) continue
      const draft = buildGeneratedNameDraft(analysis, merged)
      if (draft.generatedName) {
        setGeneratedName(item.path, draft.generatedName)
      }
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Mode
            </Label>
            <Select
              value={namingMode}
              onValueChange={value => {
                const namingMode = value as 'auto' | 'muxed' | 'vod'
                savePreferences.mutateAsync({ namingMode })
                regenerateFromCache({ namingMode })
              }}
            >
              <SelectTrigger className="h-8 w-40 bg-input text-xs">
                <SelectValue placeholder="Auto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (detect)</SelectItem>
                <SelectItem value="muxed">Muxed (spaces)</SelectItem>
                <SelectItem value="vod">VOD (dots)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Tag
            </Label>
            <Select
              value={filenameTag}
              onValueChange={value => {
                const filenameTag = value === '__none__' ? '' : value
                savePreferences.mutateAsync({ filenameTag })
                regenerateFromCache({ filenameTag })
              }}
            >
              <SelectTrigger className="h-8 w-40 bg-input text-xs">
                <SelectValue placeholder="Default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  Default ({preferences?.ionicSuffix?.trim() || 'Ionicboy'})
                </SelectItem>
                {tags.map(tag => (
                  <SelectItem key={tag} value={tag}>
                    {tag}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pl-1">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Remove year
            </Label>
            <Switch
              checked={removeYear}
              onCheckedChange={checked => {
                savePreferences.mutateAsync({ removeYear: checked })
                regenerateFromCache({ removeYear: checked })
              }}
              aria-label="Remove the year from generated filenames"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleGenerate}
            disabled={!hasItems}
            className="h-8 border-border/70 bg-input px-3 transition-colors hover:bg-muted/40"
          >
            Generate
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleUndoRename}
            disabled={!canUndoRename || isRenaming}
            className="h-8 border-border/70 bg-input px-3 transition-colors hover:bg-muted/40"
            title="Revert the last batch of renames"
          >
            Undo
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleRenameAll}
            disabled={!hasItems || isRenaming}
            className="h-8 bg-primary px-3 text-white transition-colors hover:bg-primary/80"
          >
            Rename
          </Button>
        </div>
      </div>
      {rows.length > 0 ? (
        <BatchRenameTools paths={rows.map(row => row.path)} />
      ) : null}
      {rows.length > 0 ? (
        <ExtraActionsPanel paths={rows.map(row => row.path)} />
      ) : null}
      <div className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Generated Filenames
      </div>
      <div className="space-y-2">
        {rows.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No files in the queue.
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map(row => (
              <div
                key={row.path}
                className="space-y-2 rounded-md border border-border/60 bg-secondary/35 p-3"
              >
                <div
                  className="truncate text-[11px] text-muted-foreground"
                  title={row.fileName}
                >
                  {row.fileName}
                </div>
                <div className="relative">
                  <Input
                    value={row.generatedName}
                    onChange={event =>
                      setGeneratedName(row.path, event.target.value)
                    }
                    onBlur={event =>
                      setGeneratedName(
                        row.path,
                        stripExtensionFromName(
                          event.target.value,
                          row.extension
                        )
                      )
                    }
                    className="h-10 border-border bg-input text-sm"
                    placeholder="Enter generated filename"
                  />
                  {row.generatedName.trim().length > 0 ? (
                    <span className="absolute right-3 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-accent" />
                  ) : null}
                </div>
                {row.tokens.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {row.tokens.map(token => (
                      <span
                        key={token.label}
                        className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        title={token.label}
                      >
                        <span className="text-muted-foreground/60">
                          {token.label}:{' '}
                        </span>
                        {token.value}
                      </span>
                    ))}
                  </div>
                ) : null}
                {row.warnings.length > 0 ? (
                  <ul className="space-y-0.5 text-[11px] text-amber-500">
                    {row.warnings.map(warning => (
                      <li key={warning}>⚠ {warning}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default GeneratedFilenamesPanel
