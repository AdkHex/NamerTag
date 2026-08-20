import {
  defaultPreferences,
  resolveTag,
  type AppPreferences,
} from '@/types/preferences'
import type { MediaAnalysis } from '@/types/media-analysis'
import { getLanguageDisplayName } from '@/lib/language'
import {
  buildOnDiskName,
  mapAudioCodec,
  mapVideoFormat,
  normalizeChannels,
  parseReleaseGroup,
  parseSeasonEpisode,
  parseTitleYear,
  resolveAudioAtmos,
} from '@/lib/naming-engine'

export type PrintTypeOverride = 'BluRay' | 'WEB-DL' | ''

export interface GeneratedNameDraft {
  path: string
  generatedName: string
  videoTitleText: string
  videoTitles: string[]
  audioTitles: string[]
  subtitleTitles: string[]
  encoderName: string
}

const MEDIA_EXTENSIONS = new Set([
  'mkv',
  'mp4',
  'm4v',
  'avi',
  'mov',
  'webm',
  'm2ts',
  'ts',
])

const WINDOWS_RESERVED_FILENAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
])

export function getFileName(path: string) {
  return path.split(/[/\\]/).pop() ?? path
}

export function getPathExtension(path: string) {
  const base = getFileName(path)
  const dotIndex = base.lastIndexOf('.')
  if (dotIndex <= 0) return ''
  return base.slice(dotIndex + 1)
}

export function getDirName(path: string) {
  const normalized = path.replace(/[/\\]+$/, '')
  const separator = normalized.includes('\\') ? '\\' : '/'
  const parts = normalized.split(/[/\\]/)
  parts.pop()
  return { dir: parts.join(separator), separator }
}

export function stripExtensionFromName(value: string, extension: string) {
  const trimmed = value.trim()
  if (!trimmed) return trimmed
  const lower = trimmed.toLowerCase()
  const extLower = extension.toLowerCase()
  if (extLower && lower.endsWith(`.${extLower}`)) {
    return trimmed.slice(0, -(extLower.length + 1)).trim()
  }
  const lastDot = trimmed.lastIndexOf('.')
  if (lastDot > 0) {
    const suffix = trimmed.slice(lastDot + 1).toLowerCase()
    if (MEDIA_EXTENSIONS.has(suffix)) {
      return trimmed.slice(0, lastDot).trim()
    }
  }
  return trimmed
}

export function sanitizeFilenameBase(value: string) {
  const sanitized = value
    // eslint-disable-next-line no-control-regex -- filenames must reject ASCII control characters.
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/g, '')
    .trim()
  if (!sanitized) return ''
  if (WINDOWS_RESERVED_FILENAMES.has(sanitized.toLowerCase())) {
    return `${sanitized}_`
  }
  return sanitized
}

export function buildRenameTargetPath(
  currentPath: string,
  generatedName: string
) {
  const extension = getPathExtension(currentPath)
  const baseName = sanitizeFilenameBase(
    stripExtensionFromName(generatedName, extension)
  )
  if (!baseName) {
    throw new Error(
      'Generated filename is empty after sanitizing invalid characters.'
    )
  }
  // Limit by UTF-8 byte length, not UTF-16 code units, so non-ASCII titles do not
  // silently exceed the OS NAME_MAX (255 bytes on most filesystems).
  if (new TextEncoder().encode(baseName).length > 240) {
    throw new Error('Generated filename is too long after sanitizing.')
  }
  const { dir, separator } = getDirName(currentPath)
  const filename = `${baseName}${extension ? `.${extension}` : ''}`
  return dir ? `${dir}${separator}${filename}` : filename
}

// Track titles and the on-disk filename MUST agree. These delegate to the single validated
// mapping in naming-engine.ts — the previous local copies were a stunted subset that wrote
// "DTS" into the track title while the filename said "DTS-HD MA", and mislabeled mlp/PCM.
function getAudioCodecLabel(
  codec?: string | null,
  profileOrLongName?: string | null
) {
  return mapAudioCodec(codec, profileOrLongName)
}

function getVideoCodecLabel(codec?: string | null) {
  return mapVideoFormat(codec)
}

function formatBitrate(value?: number | null) {
  if (!value) return ''
  return `${Math.round(value / 1000)}Kbps`
}

/**
 * Bit depth is only meaningful for lossless audio (PCM/FLAC/TrueHD/ALAC/DTS-HD); lossy
 * codecs quantize, so a reported depth is noise. Recognize the lossless families by codec
 * name (and DTS-HD via its profile) in addition to the stream's `lossless` flag, which the
 * backend only sets for TrueHD today.
 */
function isLosslessAudio(
  codec?: string | null,
  profile?: string | null,
  flag?: boolean
) {
  if (flag) return true
  const c = (codec ?? '').toLowerCase()
  if (c.startsWith('pcm')) return true
  if (['flac', 'truehd', 'mlp', 'alac'].includes(c)) return true
  if (c === 'dts') {
    const p = (profile ?? '').toLowerCase()
    return p.includes('ma') || p.includes('master') || p.includes('hd')
  }
  return false
}

function formatAudioBitDepth(stream: MediaAnalysis['audio'][number]): string {
  const depth = stream.bit_depth
  if (!depth || depth < 16) return ''
  if (
    !isLosslessAudio(
      stream.codec.name,
      stream.codec.profile,
      stream.flags.lossless
    )
  )
    return ''
  return `${depth}bit`
}

function formatSampleRate(value?: number | null) {
  if (!value) return ''
  return `${Math.round(value / 1000)} kHz`
}

function normalizeTemplateOutput(text: string) {
  if (!text) return ''
  const hasSlash = text.includes('/')
  if (hasSlash) {
    const parts = text
      .split('/')
      .map(part => part.trim())
      .filter(Boolean)
    return parts.join(' / ')
  }
  return (
    text
      .replace(/\s+/g, ' ')
      // Drop empty audio block "[]" left when no audio tracks resolve.
      .replace(/\[\s*\]/g, '')
      // Drop empty parens "()" and dangling separators inside parens
      // ("( - )", "(RaZoR - )", "( - Ionicboy)") left when a side is empty.
      .replace(/\(\s*\)/g, '')
      .replace(/\(\s*-\s*\)/g, '')
      .replace(/\(\s*-\s+/g, '(')
      .replace(/\s+-\s*\)/g, ')')
      .replace(/\s+-\s+/g, ' - ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

function applyTemplate(template: string, vars: Record<string, string>) {
  const value = template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    return vars[key] ?? ''
  })
  return normalizeTemplateOutput(value)
}

function buildVideoTitle(
  analysis: MediaAnalysis,
  tag: string,
  template: string,
  sourceOverride: PrintTypeOverride
) {
  const video = analysis.video[0]
  if (!video) return ''
  const resolution =
    video.dimensions.resolution_tag ||
    analysis.general.derived.resolution_tag ||
    ''
  const source = sourceOverride || analysis.general.derived.source || ''
  const hdr = analysis.general.derived.hdr_tag || ''
  const remux = analysis.general.derived.release_type === 'REMUX' ? 'REMUX' : ''
  const videoBitDepth =
    video.pixel.bit_depth && video.pixel.bit_depth >= 10 ? '10bit' : ''
  const videoCodec = getVideoCodecLabel(video.codec.name)

  return applyTemplate(template, {
    resolution,
    source,
    hdr,
    remux,
    videoBitDepth,
    videoCodec,
    trackTag: tag,
  })
}

function buildAudioTitle(
  stream: MediaAnalysis['audio'][number],
  tag: string,
  template: string,
  atmosOverride?: boolean
) {
  const language =
    stream.language.name ||
    getLanguageDisplayName(stream.language.code) ||
    stream.language.code ||
    ''
  const codecBase = getAudioCodecLabel(
    stream.codec.name,
    stream.codec.profile ?? stream.codec.long_name
  )
  const codec = codecBase
  // Shared normalizer: count-first, so 6ch reads "5.1" rather than a raw layout string.
  const channelLayout = normalizeChannels(
    stream.channels.count,
    stream.channels.layout
  )
  // Atmos rides with the channel layout, not the codec, so the template's
  // "{audioCodec} {audioChannels}" renders "TrueHD 7.1 Atmos" — the conventional order,
  // and the same one the filename builders use. Attaching it to the codec instead put it
  // before the layout ("TrueHD Atmos 7.1"). Templates are user-editable and persisted, so
  // fixing the order here rather than in the default template also repairs saved ones.
  // atmosOverride carries the engine's resolved flag (stream flag OR the filename
  // fallback), so the title agrees with the filename when ffprobe missed Atmos.
  const isAtmos = atmosOverride ?? stream.flags.atmos
  const channels =
    isAtmos && channelLayout ? `${channelLayout} Atmos` : channelLayout
  const bitrate = formatBitrate(stream.bitrate)
  const sampleRate = formatSampleRate(stream.sample_rate)
  const rendered = applyTemplate(template, {
    language,
    audioCodec: codec,
    audioChannels: channels,
    bitrate,
    sampleRate,
    audioBitDepth: formatAudioBitDepth(stream),
    trackTag: tag,
  })
  // A commentary track's identity lives in its existing title ("Commentary by Denis
  // Villeneuve"), and the template cannot reproduce it — every commentary track would
  // otherwise collapse to the same "English / DD 2.0 / ..." string, making them
  // indistinguishable. Prefix the original label so the technical details are still added.
  const existing = stream.title?.trim()
  if (stream.flags.commentary && existing) {
    return rendered ? `${existing} / ${rendered}` : existing
  }
  return rendered
}

/**
 * Classify a subtitle track into a single type, combining ffprobe disposition flags with
 * keywords in the embedded track title. Returns '' for a regular/full track.
 *
 * Accuracy note: Forced and SDH are reliable (they have ffprobe disposition flags).
 * Dubtitle / Stripped have NO disposition flag — they can only be recognized from the
 * embedded title text, since distinguishing them otherwise would require reading the
 * subtitle CONTENT (which the ffprobe stream scan does not do).
 */
export function classifySubtitle(
  stream: MediaAnalysis['subtitles'][number]
): 'Forced' | 'SDH' | 'Dubtitle' | 'Stripped' | '' {
  const title = (stream.title || '').toLowerCase()
  // Order matters: Forced first; then the title-only types (Stripped/Dubtitle) before SDH,
  // because "stripped" means SDH with cues removed (i.e. NOT SDH).
  if (
    stream.flags.forced ||
    /\b(forced|signs?(?:\s*(?:&|and)?\s*songs?)?)\b/.test(title)
  )
    return 'Forced'
  if (/strip/.test(title)) return 'Stripped'
  if (/\bdub(?:title)?s?\b/.test(title)) return 'Dubtitle'
  if (
    stream.flags.hearing_impaired ||
    /\b(sdh|hearing[\s-]?impaired|hard of hearing|cc)\b/.test(title)
  )
    return 'SDH'
  return ''
}

function buildSubtitleTitle(
  stream: MediaAnalysis['subtitles'][number],
  tag: string,
  template: string
) {
  const language =
    stream.language.name ||
    getLanguageDisplayName(stream.language.code) ||
    stream.language.code ||
    ''
  const classification = classifySubtitle(stream)
  return applyTemplate(template, {
    language,
    subtitleFlags: classification,
    trackTag: tag,
  })
}

// Delegate to the single validated parser in naming-engine.ts (last-year selection,
// SxxExx-aware) instead of re-deriving title/year here, keeping the three call sites in
// agreement. Return shape is preserved for the existing callers.
function parseTitleParts(filename: string) {
  const { title, year } = parseTitleYear(filename)
  return {
    titlePart: title,
    year,
    seasonEpisode: parseSeasonEpisode(filename),
  }
}

function buildVideoTitleText(
  analysis: MediaAnalysis,
  tag: string,
  template: string
) {
  const filename = analysis.general.file.filename || ''
  const { titlePart, year, seasonEpisode } = parseTitleParts(filename)
  const baseTitle =
    analysis.general.derived.title ||
    titlePart ||
    filename.replace(/\.[^.]+$/, '')
  const title = baseTitle.replace(/[[({]+\s*$/g, '').trim()
  const yearValue = analysis.general.derived.year?.toString() || year || ''
  return applyTemplate(template, {
    title,
    year: yearValue,
    seasonEpisode,
    filenameTag: tag,
  })
}

/**
 * Embedded container title: "Series Name (Year) S01E01 - Downloaded From <tag>".
 * Year and SxxExx are omitted when absent; the "- Downloaded From" suffix only appears
 * when a tag is set. The title is parsed cleanly (cut at the year or SxxExx marker),
 * never the whole release string.
 */
function buildContainerTitle(analysis: MediaAnalysis, tag: string) {
  const filename = analysis.general.file.filename || ''
  const { title: parsedTitle, year: parsedYear } = parseTitleYear(filename)
  const title =
    parsedTitle ||
    analysis.general.derived.title ||
    filename.replace(/\.[^.]+$/, '')
  const year = parsedYear || (analysis.general.derived.year?.toString() ?? '')
  const seasonEpisode = parseSeasonEpisode(filename)
  const titleWithYear = `${title}${year ? ` (${year})` : ''}`
  const base = [titleWithYear, seasonEpisode].filter(Boolean).join(' ').trim()
  const trimmedTag = tag.trim()
  return trimmedTag ? `${base} - Downloaded From ${trimmedTag}` : base
}

export function buildGeneratedNameDraft(
  analysis: MediaAnalysis,
  preferences?: AppPreferences
): GeneratedNameDraft {
  const filename = analysis.general.file.filename || ''
  const path = analysis.general.file.path || filename
  const trackTag = resolveTag(preferences?.selectedTag, preferences?.tags?.[0])
  const printTypeOverride = preferences?.printTypeOverride || ''
  const videoTrackTemplate =
    preferences?.videoTrackTemplate || defaultPreferences.videoTrackTemplate
  const audioTrackTemplate =
    preferences?.audioTrackTemplate || defaultPreferences.audioTrackTemplate
  const subtitleTrackTemplate =
    preferences?.subtitleTrackTemplate ||
    defaultPreferences.subtitleTrackTemplate
  const videoTitleTemplate =
    preferences?.videoTitleTemplate || defaultPreferences.videoTitleTemplate

  // Original release group (hyphen-delimited only) or the user's encoder override.
  const group = preferences?.encoderName?.trim() || parseReleaseGroup(filename)
  // Muxed suffix: the selected Filename tag wins, then the default suffix preference.
  // NO_TAG suppresses the suffix entirely rather than falling through to the default.
  const muxedSuffix = resolveTag(
    preferences?.filenameTag,
    preferences?.ionicSuffix?.trim() || defaultPreferences.ionicSuffix
  )
  const generatedName = sanitizeFilenameBase(
    stripExtensionFromName(
      buildOnDiskName(analysis, {
        mode: preferences?.namingMode ?? defaultPreferences.namingMode,
        printTypeOverride,
        group,
        ionicSuffix: muxedSuffix,
        removeYear: preferences?.removeYear ?? false,
        languagePriority:
          preferences?.languagePriority ?? defaultPreferences.languagePriority,
        videoCodecOverrides: preferences?.videoCodecOverrides,
        audioCodecOverrides: preferences?.audioCodecOverrides,
        languageOverrides: preferences?.languageOverrides,
      }),
      analysis.general.file.extension || ''
    )
  )

  // Atmos resolved the same way the filename resolves it (stream flag, else the filename
  // fallback), so an embedded title never disagrees with the name on disk.
  const atmosByStream = resolveAudioAtmos(analysis, {
    audioCodecOverrides: preferences?.audioCodecOverrides,
    languageOverrides: preferences?.languageOverrides,
  })

  // Embedded container title: "Title (Year) SxxExx - Downloaded From <tag>" (the tag is
  // the selected track tag). The custom video-title template is opt-in via legacy toggle.
  const containerTitle = preferences?.legacyContainerTitle
    ? buildVideoTitleText(analysis, trackTag, videoTitleTemplate)
    : buildContainerTitle(analysis, trackTag)

  return {
    path,
    generatedName,
    // --- Track-title builders below are intentionally UNCHANGED. ---
    videoTitleText: containerTitle,
    videoTitles: [
      buildVideoTitle(
        analysis,
        trackTag,
        videoTrackTemplate,
        printTypeOverride
      ),
    ].filter(Boolean),
    audioTitles: analysis.audio.map((stream, index) =>
      buildAudioTitle(stream, trackTag, audioTrackTemplate, atmosByStream[index])
    ),
    subtitleTitles: analysis.subtitles.map(stream =>
      buildSubtitleTitle(stream, trackTag, subtitleTrackTemplate)
    ),
    encoderName: group,
  }
}
