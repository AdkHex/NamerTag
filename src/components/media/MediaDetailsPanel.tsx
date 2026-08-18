import { useEffect, useMemo } from 'react'
import { useLocalUploadQueue } from '@/store/local-upload-queue-store'
import { useGeneratedNamesStore } from '@/store/generated-names-store'
import { useMediaAnalysisStore } from '@/store/media-analysis-store'
import type { MediaAnalysis } from '@/types/media-analysis'
import {
  TreeLabel,
  TreeNode,
  TreeNodeContent,
  TreeNodeTrigger,
  TreeProvider,
  TreeView,
} from '@/components/kibo-ui/tree'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Info } from 'lucide-react'
import { logger } from '@/lib/logger'
import { getLanguageDisplayName } from '@/lib/language'

function getFileName(path: string) {
  return path.split(/[/\\\\]/).pop() ?? path
}

function formatVideoInfo(stream: MediaAnalysis['video'][number]) {
  const parts: string[] = []
  if (stream.codec.long_name) parts.push(stream.codec.long_name)
  if (stream.codec.profile) parts.push(stream.codec.profile)
  if (stream.pixel.pixel_format) parts.push(stream.pixel.pixel_format)
  if (stream.pixel.bit_depth) parts.push(`${stream.pixel.bit_depth}-bit`)
  if (stream.color.transfer) parts.push(stream.color.transfer)
  return parts.join(' • ')
}

function formatAudioInfo(stream: MediaAnalysis['audio'][number]) {
  const parts: string[] = []
  if (stream.codec.long_name) parts.push(stream.codec.long_name)
  if (stream.bitrate) parts.push(`${Math.round(stream.bitrate / 1000)}Kbps`)
  if (stream.sample_rate)
    parts.push(`${Math.round(stream.sample_rate / 1000)} kHz`)
  if (stream.channels.layout) parts.push(stream.channels.layout)
  return parts.join(' • ')
}

function formatSubtitleInfo(stream: MediaAnalysis['subtitles'][number]) {
  const parts: string[] = []
  if (stream.codec) parts.push(stream.codec)
  if (stream.flags.forced) parts.push('Forced')
  if (stream.flags.hearing_impaired) parts.push('SDH')
  return parts.join(' • ')
}

function getVideoTitle(
  stream: MediaAnalysis['video'][number],
  title?: string | null
) {
  if (title) return title
  const codec = stream.codec.name?.toUpperCase()
  const res = stream.dimensions.resolution_tag
  if (codec && res) return `${codec} ${res}`
  return codec || res || 'Video'
}

function getAudioTitle(
  stream: MediaAnalysis['audio'][number],
  title?: string | null
) {
  return (
    title ||
    stream.derived.display_name ||
    stream.language.name ||
    getLanguageDisplayName(stream.language.code) ||
    stream.language.code ||
    'Audio'
  )
}

function getSubtitleTitle(
  stream: MediaAnalysis['subtitles'][number],
  title?: string | null
) {
  if (title) return title
  const name =
    stream.language.name ||
    getLanguageDisplayName(stream.language.code) ||
    stream.language.code ||
    'Subtitle'
  const flags: string[] = []
  if (stream.flags.forced) flags.push('Forced')
  if (stream.flags.hearing_impaired) flags.push('SDH')
  if (flags.length === 0) return name
  return `${name} ${flags.join(' ')}`
}

export function MediaDetailsPanel() {
  const items = useLocalUploadQueue(s => s.items)
  const { analysesByPath, loadAnalyses, loading, error } =
    useMediaAnalysisStore()
  const generatedEntries = useGeneratedNamesStore(s => s.entries)
  const paths = useMemo(() => items.map(item => item.path), [items])
  const treeKey = useMemo(() => paths.join('|'), [paths])
  const defaultExpandedIds = useMemo(() => {
    const ids: string[] = []
    paths.forEach(path => {
      ids.push(`file:${path}`)
      const videoTitle = generatedEntries[path]?.videoTitleText
      if (videoTitle) ids.push(`group:${path}:videoTitle`)
      const info = analysesByPath[path]
      if (info?.video.length) ids.push(`group:${path}:video`)
      if (info?.audio.length) ids.push(`group:${path}:audio`)
      if (info?.subtitles.length) ids.push(`group:${path}:subtitles`)
    })
    return ids
  }, [analysesByPath, generatedEntries, paths])

  useEffect(() => {
    loadAnalyses(paths).catch(error => {
      logger.warn('Failed to load media analysis', { error: String(error) })
    })
  }, [loadAnalyses, paths])

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Media Details</h2>
        <p className="text-xs text-muted-foreground">
          Video, audio, and subtitle streams per file.
        </p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto pr-1">
        {paths.length === 0 ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Add files to see their media streams.
          </div>
        ) : error ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Failed to load media details: {error}
          </div>
        ) : loading ? (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            Loading media details…
          </div>
        ) : (
          <TreeProvider
            key={treeKey}
            defaultExpandedIds={defaultExpandedIds}
            showLines
            showIcons={false}
            selectable={false}
            animateExpand={false}
            className="min-h-0 flex-1"
          >
            <TreeView className="space-y-1">
              {paths.map((path, fileIndex) => {
                const info = analysesByPath[path]
                const hasStreams =
                  Boolean(info?.video.length) ||
                  Boolean(info?.audio.length) ||
                  Boolean(info?.subtitles.length)
                const fileId = `file:${path}`
                const videoTitleText =
                  generatedEntries[path]?.videoTitleText ?? ''
                const level1Nodes: (
                  | { type: 'videoTitle'; key: string; title: string }
                  | { type: 'empty'; key: string; message: string }
                  | {
                      type: 'group'
                      key: string
                      label: string
                      items: MediaAnalysis['video' | 'audio' | 'subtitles']
                      kind: 'video' | 'audio' | 'subtitles'
                    }
                )[] = []

                if (videoTitleText) {
                  level1Nodes.push({
                    type: 'videoTitle',
                    key: `group:${path}:videoTitle`,
                    title: videoTitleText,
                  })
                }

                if (!hasStreams) {
                  level1Nodes.push({
                    type: 'empty',
                    key: `${fileId}:empty`,
                    message: 'No stream details available.',
                  })
                } else {
                  if (info?.video.length) {
                    level1Nodes.push({
                      type: 'group',
                      key: `group:${path}:video`,
                      label: `video (${info.video.length})`,
                      items: info.video,
                      kind: 'video',
                    })
                  }
                  if (info?.audio.length) {
                    level1Nodes.push({
                      type: 'group',
                      key: `group:${path}:audio`,
                      label: `audio (${info.audio.length})`,
                      items: info.audio,
                      kind: 'audio',
                    })
                  }
                  if (info?.subtitles.length) {
                    level1Nodes.push({
                      type: 'group',
                      key: `group:${path}:subtitles`,
                      label: `subtitles (${info.subtitles.length})`,
                      items: info.subtitles,
                      kind: 'subtitles',
                    })
                  }
                }

                return (
                  <TreeNode
                    key={path}
                    nodeId={fileId}
                    isLast={fileIndex === paths.length - 1}
                  >
                    <TreeNodeTrigger>
                      <TreeLabel>{getFileName(path)}</TreeLabel>
                    </TreeNodeTrigger>
                    <TreeNodeContent hasChildren>
                      {level1Nodes.map((node, nodeIndex) => {
                        const isLast = nodeIndex === level1Nodes.length - 1
                        if (node.type === 'videoTitle') {
                          return (
                            <TreeNode
                              key={node.key}
                              nodeId={node.key}
                              level={1}
                              isLast={isLast}
                            >
                              <TreeNodeTrigger>
                                <TreeLabel className="text-sm font-semibold uppercase tracking-wide text-foreground/80">
                                  Video Title
                                </TreeLabel>
                              </TreeNodeTrigger>
                              <TreeNodeContent hasChildren>
                                <TreeNode
                                  level={2}
                                  nodeId={`item:${path}:videoTitle`}
                                  isLast
                                >
                                  <TreeNodeTrigger>
                                    <TreeLabel className="text-xs text-muted-foreground">
                                      {node.title}
                                    </TreeLabel>
                                  </TreeNodeTrigger>
                                </TreeNode>
                              </TreeNodeContent>
                            </TreeNode>
                          )
                        }

                        if (node.type === 'empty') {
                          return (
                            <TreeNode
                              key={node.key}
                              nodeId={node.key}
                              level={1}
                              isLast={isLast}
                            >
                              <TreeNodeTrigger>
                                <TreeLabel className="text-xs text-muted-foreground">
                                  {node.message}
                                </TreeLabel>
                              </TreeNodeTrigger>
                            </TreeNode>
                          )
                        }

                        const groupId = node.key
                        return (
                          <TreeNode
                            key={groupId}
                            nodeId={groupId}
                            level={1}
                            isLast={isLast}
                          >
                            <TreeNodeTrigger>
                              <TreeLabel className="text-xs font-semibold uppercase tracking-wide text-foreground/80">
                                {node.label}
                              </TreeLabel>
                            </TreeNodeTrigger>
                            <TreeNodeContent hasChildren>
                              {node.items.map((stream, streamIndex) => {
                                const generatedEntry = generatedEntries[path]
                                const title =
                                  node.kind === 'video'
                                    ? getVideoTitle(
                                        stream as MediaAnalysis['video'][number],
                                        generatedEntry?.videoTitles?.[
                                          streamIndex
                                        ] ?? null
                                      )
                                    : node.kind === 'audio'
                                      ? getAudioTitle(
                                          stream as MediaAnalysis['audio'][number],
                                          generatedEntry?.audioTitles?.[
                                            streamIndex
                                          ] ?? null
                                        )
                                      : getSubtitleTitle(
                                          stream as MediaAnalysis['subtitles'][number],
                                          generatedEntry?.subtitleTitles?.[
                                            streamIndex
                                          ] ?? null
                                        )
                                const infoText =
                                  node.kind === 'video'
                                    ? formatVideoInfo(
                                        stream as MediaAnalysis['video'][number]
                                      )
                                    : node.kind === 'audio'
                                      ? formatAudioInfo(
                                          stream as MediaAnalysis['audio'][number]
                                        )
                                      : formatSubtitleInfo(
                                          stream as MediaAnalysis['subtitles'][number]
                                        )
                                const streamIndexValue =
                                  node.kind === 'video'
                                    ? (stream as MediaAnalysis['video'][number])
                                        .stream_index
                                    : node.kind === 'audio'
                                      ? (
                                          stream as MediaAnalysis['audio'][number]
                                        ).stream_index
                                      : (
                                          stream as MediaAnalysis['subtitles'][number]
                                        ).stream_index
                                return (
                                  <TreeNode
                                    key={`${groupId}:${streamIndexValue}`}
                                    nodeId={`stream:${path}:${node.kind}:${streamIndexValue}`}
                                    level={2}
                                    isLast={
                                      streamIndex === node.items.length - 1
                                    }
                                  >
                                    <TreeNodeTrigger>
                                      <TreeLabel className="text-xs text-muted-foreground">
                                        {title}
                                      </TreeLabel>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <button
                                            type="button"
                                            className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/70 transition hover:text-muted-foreground"
                                            aria-label="Track info"
                                          >
                                            <Info className="h-3.5 w-3.5" />
                                          </button>
                                        </TooltipTrigger>
                                        <TooltipContent
                                          side="top"
                                          sideOffset={6}
                                          className="border-border bg-popover text-popover-foreground"
                                        >
                                          {infoText || 'No additional info'}
                                        </TooltipContent>
                                      </Tooltip>
                                    </TreeNodeTrigger>
                                  </TreeNode>
                                )
                              })}
                            </TreeNodeContent>
                          </TreeNode>
                        )
                      })}
                    </TreeNodeContent>
                  </TreeNode>
                )
              })}
            </TreeView>
          </TreeProvider>
        )}
      </div>
    </div>
  )
}

export default MediaDetailsPanel
