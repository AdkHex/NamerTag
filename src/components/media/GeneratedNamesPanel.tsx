import { useMemo, useState } from 'react'
import { useGeneratedNamesStore } from '@/store/generated-names-store'
import { useLocalUploadQueue } from '@/store/local-upload-queue-store'
import { Button } from '@/components/ui/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Label } from '../ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { ChevronDown, Loader2, X } from 'lucide-react'
import { usePreferences, useSavePreferences } from '@/services/preferences'
import { useQueueActions } from '@/components/upload/useQueueActions'

interface TrackItem {
  path: string
  fileName: string
  index: number | null
  title: string
}

type GroupType = 'container' | 'video' | 'audio' | 'subtitle'

function getFileName(path: string) {
  return path.split(/[/\\]/).pop() ?? path
}

export function GeneratedNamesPanel() {
  const items = useLocalUploadQueue(s => s.items)
  const entries = useGeneratedNamesStore(s => s.entries)
  const setVideoTitleText = useGeneratedNamesStore(s => s.setVideoTitleText)
  const setVideoTitleAtIndex = useGeneratedNamesStore(
    s => s.setVideoTitleAtIndex
  )
  const setAudioTitleAtIndex = useGeneratedNamesStore(
    s => s.setAudioTitleAtIndex
  )
  const setSubtitleTitleAtIndex = useGeneratedNamesStore(
    s => s.setSubtitleTitleAtIndex
  )
  const { data: preferences } = usePreferences()
  const savePreferences = useSavePreferences()
  const { isRetagging, retaggingPath, hasItems, handleGenerate, handleRetag } =
    useQueueActions()

  const tags = preferences?.tags ?? []
  const selectedTag = preferences?.selectedTag || tags[0] || '__empty__'
  const printType =
    (preferences?.printTypeOverride as 'BluRay' | 'WEB-DL' | '') || ''

  const ordered = useMemo(
    () =>
      items.map(item => ({
        original: item.path,
        fileName: getFileName(item.path),
        videoTitleText: entries[item.path]?.videoTitleText ?? '',
        videoTitles: entries[item.path]?.videoTitles ?? [],
        audioTitles: entries[item.path]?.audioTitles ?? [],
        subtitleTitles: entries[item.path]?.subtitleTitles ?? [],
      })),
    [entries, items]
  )
  const [openFiles, setOpenFiles] = useState<Record<string, boolean>>({})

  // Baseline for dirty-tracking now lives in the store (captured at generation time and
  // re-keyed on rename), so it survives rename and remount.
  const onGenerate = async () => {
    await handleGenerate()
  }
  const [sectionOpen, setSectionOpen] = useState<
    Record<
      string,
      {
        video: boolean
        audio: boolean
        subtitle: boolean
      }
    >
  >({})

  const updateRowEdit = (type: GroupType, item: TrackItem, value: string) => {
    if (item.index === null && type !== 'container') return
    if (type === 'container') {
      setVideoTitleText(item.path, value)
    } else if (item.index !== null) {
      if (type === 'video') {
        setVideoTitleAtIndex(item.path, item.index, value)
      } else if (type === 'audio') {
        setAudioTitleAtIndex(item.path, item.index, value)
      } else if (type === 'subtitle') {
        setSubtitleTitleAtIndex(item.path, item.index, value)
      }
    }
  }

  const clearRowEdit = (type: GroupType, item: TrackItem) => {
    const base = entries[item.path]?.baseline
    const resetValue =
      type === 'container'
        ? (base?.videoTitleText ?? item.title)
        : type === 'video'
          ? (base?.videoTitles?.[item.index ?? 0] ?? item.title)
          : type === 'audio'
            ? (base?.audioTitles?.[item.index ?? 0] ?? item.title)
            : (base?.subtitleTitles?.[item.index ?? 0] ?? item.title)
    updateRowEdit(type, item, resetValue)
  }

  const isFieldDirty = (type: GroupType, item: TrackItem, value: string) => {
    const base = entries[item.path]?.baseline
    if (!base) return false
    const baseValue =
      type === 'container'
        ? base.videoTitleText
        : type === 'video'
          ? (base.videoTitles[item.index ?? 0] ?? '')
          : type === 'audio'
            ? (base.audioTitles[item.index ?? 0] ?? '')
            : (base.subtitleTitles[item.index ?? 0] ?? '')
    return value.trim() !== (baseValue ?? '').trim()
  }

  const renderTrackRows = (
    type: GroupType,
    items: TrackItem[],
    emptyLabel: string
  ) => {
    if (items.length === 0) {
      return <div className="text-xs text-muted-foreground">{emptyLabel}</div>
    }
    return (
      <div className="">
        {items.map(item => {
          const rowKey = `${type}:${item.path}:${item.index ?? 'container'}`
          const editValue = item.title
          const isDirty = isFieldDirty(type, item, editValue)
          const label =
            type === 'audio'
              ? `Audio ${item.index !== null ? item.index + 1 : ''}`.trim()
              : type === 'subtitle'
                ? `Subtitle ${item.index !== null ? item.index + 1 : ''}`.trim()
                : ''
          return (
            <div
              key={rowKey}
              className={cn(
                'flex items-start gap-3 py-2 text-xs text-muted-foreground'
              )}
            >
              <div className="min-w-0 flex flex-col w-full gap-1">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="truncate">{label}</span>
                  {isDirty ? (
                    <span className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] uppercase text-accent">
                      Modified
                    </span>
                  ) : null}
                </div>
                <InputGroup className="h-7">
                  <InputGroupInput
                    value={editValue}
                    onChange={event =>
                      updateRowEdit(type, item, event.target.value)
                    }
                    className="text-xs text-white placeholder:text-muted-foreground"
                    placeholder={
                      type === 'container' ? 'Container Title' : 'Stream Title'
                    }
                  />
                  {isDirty ? (
                    <InputGroupAddon align="inline-end" className="gap-1">
                      <InputGroupButton
                        size="icon-xs"
                        variant="ghost-nohover"
                        onClick={() => clearRowEdit(type, item)}
                        title="Clear"
                        className="text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </InputGroupButton>
                    </InputGroupAddon>
                  ) : null}
                </InputGroup>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const renderSingleRow = (
    type: GroupType,
    item: TrackItem,
    label: string,
    placeholder: string
  ) => {
    const rowKey = `${type}:${item.path}:${item.index ?? 'container'}`
    const editValue = item.title
    const isDirty = isFieldDirty(type, item, editValue)
    return (
      <div
        key={rowKey}
        className="flex items-start gap-3 text-xs text-muted-foreground"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="truncate">{label}</span>
            {isDirty ? (
              <span className="rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] uppercase text-accent">
                Modified
              </span>
            ) : null}
          </div>
          <InputGroup className="mt-1 h-7 ">
            <InputGroupInput
              value={editValue}
              onChange={event => updateRowEdit(type, item, event.target.value)}
              className="text-xs text-white placeholder:text-muted-foreground"
              placeholder={placeholder}
            />
            {isDirty ? (
              <InputGroupAddon align="inline-end" className="gap-1">
                <InputGroupButton
                  size="icon-sm"
                  variant="ghost-nohover"
                  onClick={() => clearRowEdit(type, item)}
                  title="Clear"
                  className="text-destructive"
                >
                  <X className="h-4 w-4" />
                </InputGroupButton>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      <div className="flex  items-center justify-between gap-4 bg-secondary ">
        <div className="flex items-center gap-4">
          {/* <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Track Title Settings
          </div> */}
          <div className="min-w-[220px] space-y-2">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Track title tag
            </Label>
            <Select
              value={selectedTag}
              onValueChange={value => {
                if (value === '__empty__') return
                savePreferences.mutateAsync({ selectedTag: value })
              }}
            >
              <SelectTrigger className="h-8 w-full bg-input text-sm">
                <SelectValue placeholder="Track Title Tag" />
              </SelectTrigger>
              <SelectContent>
                {tags.length === 0 ? (
                  <SelectItem value="__empty__" disabled>
                    No tags yet
                  </SelectItem>
                ) : (
                  tags.map(tag => (
                    <SelectItem key={tag} value={tag}>
                      {tag}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[180px] space-y-2">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Print type
            </Label>
            <Select
              value={printType || '__auto__'}
              onValueChange={value =>
                savePreferences.mutateAsync({
                  printTypeOverride:
                    value === '__auto__' ? '' : (value as 'BluRay' | 'WEB-DL'),
                })
              }
            >
              <SelectTrigger className="h-8 w-full bg-input text-sm">
                <SelectValue placeholder="Auto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto__">Auto</SelectItem>
                <SelectItem value="BluRay">BluRay</SelectItem>
                <SelectItem value="WEB-DL">WEB-DL</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onGenerate}
            disabled={!hasItems}
            className="p-4 border-border/70 bg-input text-white transition-colors hover:bg-muted/40 hover:text-white"
          >
            Generate
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleRetag}
            disabled={!hasItems || isRetagging}
            className={cn(
              'bg-primary p-4 text-white transition-colors hover:bg-primary/80 '
            )}
          >
            Retag
          </Button>
        </div>
      </div>
      <div className="mt-4">
        <div className="text-sm font-semibold text-foreground">
          Generated Track Titles
        </div>
        {/* <div className="text-xs text-muted-foreground">
          {videoTitleCount} video titles • {audioTitleCount} audio titles •{' '}
          {subtitleTitleCount} subtitle titles
        </div> */}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto pb-2">
        {ordered.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            No generated names yet.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {ordered.map(entry => {
              const isOpen = openFiles[entry.original] ?? true
              const toggle = () =>
                setOpenFiles(prev => ({
                  ...prev,
                  [entry.original]: !isOpen,
                }))
              const sectionState = sectionOpen[entry.original] ?? {
                video: true,
                audio: true,
                subtitle: false,
              }
              const toggleSection = (key: 'video' | 'audio' | 'subtitle') =>
                setSectionOpen(prev => ({
                  ...prev,
                  [entry.original]: {
                    ...(prev[entry.original] ?? {
                      video: true,
                      audio: true,
                      subtitle: false,
                    }),
                    [key]: !sectionState[key],
                  },
                }))
              const containerItem: TrackItem = {
                path: entry.original,
                fileName: entry.fileName,
                index: null,
                title: entry.videoTitleText,
              }
              const videoItems: TrackItem[] = entry.videoTitles.map(
                (title, i) => ({
                  path: entry.original,
                  fileName: entry.fileName,
                  index: i,
                  title,
                })
              )
              const audioItems: TrackItem[] = entry.audioTitles.map(
                (title, i) => ({
                  path: entry.original,
                  fileName: entry.fileName,
                  index: i,
                  title,
                })
              )
              const subtitleItems: TrackItem[] = entry.subtitleTitles.map(
                (title, i) => ({
                  path: entry.original,
                  fileName: entry.fileName,
                  index: i,
                  title,
                })
              )

              return (
                <div
                  key={entry.original}
                  className="overflow-hidden rounded-lg border border-border/60"
                >
                  <button
                    type="button"
                    onClick={toggle}
                    className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    style={{ backgroundColor: '#26292E' }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 text-muted-foreground transition-transform',
                          {
                            '-rotate-90': !isOpen,
                          }
                        )}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {entry.fileName}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {entry.videoTitles.length} video •{' '}
                          {entry.audioTitles.length} audio •{' '}
                          {entry.subtitleTitles.length} subtitles
                        </div>
                      </div>
                    </div>
                    {isRetagging && retaggingPath === entry.original ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                    ) : (
                      <span className="h-3.5 w-3.5" />
                    )}
                  </button>
                  {isOpen ? (
                    <div className=" p-4 space-y-4">
                      {renderSingleRow(
                        'container',
                        containerItem,
                        'Container Title',
                        'Container Title'
                      )}
                      {(() => {
                        const firstVideo = videoItems[0]
                        return firstVideo ? (
                          renderSingleRow(
                            'video',
                            firstVideo,
                            'Video track',
                            'Video track'
                          )
                        ) : (
                          <div className="text-xs text-muted-foreground">
                            No video track.
                          </div>
                        )
                      })()}
                      <Separator className="bg-border/25" />
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => toggleSection('audio')}
                          className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          <span className="flex items-center gap-2">
                            {/* <Music className="h-4 w-4" /> */}
                            Audio tracks
                          </span>
                          <ChevronDown
                            className={cn(
                              'h-4 w-4 transition-transform',
                              sectionState.audio ? '' : '-rotate-90'
                            )}
                          />
                        </button>
                        {sectionState.audio
                          ? renderTrackRows(
                              'audio',
                              audioItems,
                              'No audio tracks.'
                            )
                          : null}
                      </div>
                      <Separator className="bg-border/25" />{' '}
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => toggleSection('subtitle')}
                          className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                        >
                          <span className="flex items-center gap-2">
                            {/* <Subtitles className="h-4 w-4" /> */}
                            Subtitle tracks
                          </span>
                          <ChevronDown
                            className={cn(
                              'h-4 w-4 transition-transform',
                              sectionState.subtitle ? '' : '-rotate-90'
                            )}
                          />
                        </button>
                        {sectionState.subtitle
                          ? renderTrackRows(
                              'subtitle',
                              subtitleItems,
                              'No subtitle tracks.'
                            )
                          : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default GeneratedNamesPanel
