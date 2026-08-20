import type { MediaAnalysis } from '@/types/media-analysis'
import { getLanguageDisplayName } from '@/lib/language'

/**
 * Naming engine — produces the on-disk filename only.
 *
 * Deliberately isolated from metadata-title generation (buildVideoTitleText /
 * buildAudioTitle in naming.ts). It derives a normalized `ParsedMedia` from raw ffprobe
 * stream fields + the filename, then renders either the muxed (human-readable, spaces) or
 * the VOD (scene, dots) form.
 *
 * Fallback priority (audit §E): ffprobe stream data → existing metadata tags → filename
 * tokens → caller override. Source labels (BluRay/WEB-DL/UHD) are NOT in ffprobe, so they
 * come from the filename or an explicit print-type override.
 */

export type NamingMode = 'auto' | 'muxed' | 'vod'
export type PrintTypeOverride = 'BluRay' | 'WEB-DL' | ''

export interface AudioPart {
  language: string // display name, e.g. "Hindi" ('' when unknown)
  langCode: string // ISO code for ordering, e.g. "hin"
  codec: string // mapped label, e.g. "DDP", "DTS-HD MA"
  channels: string // normalized, e.g. "5.1"
  atmos: boolean
  // Director's commentary / audio description. Optional so callers constructing an
  // AudioPart directly (tests, overrides) can omit it; absent means "main track".
  commentary?: boolean
}

export interface ParsedMedia {
  title: string
  year: string
  seasonEpisode: string
  resolution: string // "2160p" | "1080p" | "720p" | ""
  source: string // "UHD BluRay" | "BluRay" | "WEB-DL" | "WEBRip" | ""
  provider: string // "AMZN" / "NF" ... (web only)
  isRemux: boolean
  bitDepth10: boolean
  hdr: string // "DV HDR" | "DoVi HDR" | "HDR10+" | "HDR" | "" (never "SDR")
  sdr: boolean // confirmed non-HDR at 2160p only; emitted as an explicit "SDR" token
  videoFormat: string // "AVC" | "HEVC" | "AV1" | "VP9" | "XviD" | ""
  videoFinal: string // "x264" | "x265" | "AV1" | "VP9" | ...
  audio: AudioPart[]
  group: string // original release group ('' when none)
  ionicSuffix: string // appended to group in muxed mode
}

export interface NamingOptions {
  mode?: NamingMode
  printTypeOverride?: PrintTypeOverride
  group?: string // pre-resolved original release group; falls back to filename parse
  ionicSuffix?: string // default "Ionicboy"
  removeYear?: boolean // drop the year from the generated filename when true
  languagePriority?: string[] // ISO codes, default ["hin", "eng"]
  dvStyle?: 'DoVi' | 'DV' // default "DoVi"
  // User overrides applied on top of the built-in mappings. Keyed by lowercase ffprobe
  // codec_name (video/audio) or lowercase ISO language code.
  videoCodecOverrides?: Record<string, string>
  audioCodecOverrides?: Record<string, string>
  languageOverrides?: Record<string, string>
}

const WEB_PROVIDERS = [
  'NF',
  'AMZN',
  'ATVP',
  'ATV',
  'DSNP',
  'HMAX',
  'MAX',
  'HULU',
  'PCOK',
  'PMTP',
  'STAN',
  'CR',
  'iT',
]

// ---- mappers --------------------------------------------------------------------------

export function mapVideoFormat(codec?: string | null): string {
  switch ((codec ?? '').toLowerCase()) {
    case 'h264':
    case 'avc':
      return 'AVC'
    case 'hevc':
    case 'h265':
      return 'HEVC'
    case 'av1':
      return 'AV1'
    case 'vp9':
      return 'VP9'
    case 'vc1':
      return 'VC-1'
    case 'mpeg2video':
      return 'MPEG-2'
    case 'mpeg4':
    case 'msmpeg4v3':
      return 'XviD'
    default:
      return codec ? codec.toUpperCase() : ''
  }
}

export function mapVideoFinal(
  codec?: string | null,
  overrides?: Record<string, string>
): string {
  const key = (codec ?? '').toLowerCase()
  if (key && overrides?.[key]) return overrides[key]
  switch (key) {
    case 'h264':
    case 'avc':
      return 'x264'
    case 'hevc':
    case 'h265':
      return 'x265'
    case 'av1':
      return 'AV1'
    case 'vp9':
      return 'VP9'
    case 'vc1':
      return 'VC-1'
    case 'mpeg2video':
      return 'MPEG-2'
    case 'mpeg4':
    case 'msmpeg4v3':
      return 'XviD'
    default:
      return codec ? codec.toUpperCase() : ''
  }
}

export function mapAudioCodec(
  codec?: string | null,
  profileOrLongName?: string | null,
  overrides?: Record<string, string>
): string {
  const c = (codec ?? '').toLowerCase()
  if (c && overrides?.[c]) return overrides[c]
  const hint = (profileOrLongName ?? '').toLowerCase()
  if (c === 'dts') {
    // Match whole words only. A bare `includes` substring test misfires badly here:
    // "DTS Express" contains "es" (-> DTS-ES) and "DTS-HD Master Audio" contains "ma"
    // anywhere. Order matters: DTS:X, then MA, then HRA, then ES.
    if (/\bdts[:-]?x\b/.test(hint)) return 'DTS:X'
    if (/\b(ma|master(\s*audio)?)\b/.test(hint)) return 'DTS-HD MA'
    if (/\b(hra|high[\s-]?res(olution)?)\b/.test(hint)) return 'DTS-HD HRA'
    if (/\bes\b/.test(hint)) return 'DTS-ES'
    if (/\bexpress\b/.test(hint)) return 'DTS Express'
    return 'DTS'
  }
  if (c.startsWith('pcm')) return 'PCM'
  switch (c) {
    case 'eac3':
      return 'DDP'
    case 'ac3':
      return 'DD'
    case 'truehd':
    case 'mlp':
      return 'TrueHD'
    case 'aac':
      return 'AAC'
    case 'flac':
      return 'FLAC'
    case 'opus':
      return 'Opus'
    case 'mp3':
      return 'MP3'
    case 'alac':
      return 'ALAC'
    case 'vorbis':
      return 'Vorbis'
    case 'wmav2':
    case 'wmapro':
      return 'WMA'
    default:
      return codec ? codec.toUpperCase() : ''
  }
}

export function normalizeChannels(
  count?: number | null,
  layout?: string | null
): string {
  const byCount: Record<number, string> = {
    8: '7.1',
    7: '6.1',
    6: '5.1',
    5: '5.0',
    4: '4.0',
    3: '3.0',
    2: '2.0',
    1: '1.0',
  }
  const mappedByCount = count ? byCount[count] : undefined
  if (mappedByCount) return mappedByCount
  if (layout) {
    const raw = layout.split('(')[0]?.trim() ?? ''
    const cleaned = raw.toLowerCase()
    if (cleaned === 'stereo') return '2.0'
    if (cleaned === 'mono') return '1.0'
    if (raw) return raw
  }
  // Unmapped count with no layout: render as "N.0" rather than a bare "N", so a 9-channel
  // track reads "9.0" and never leaks a lone digit into the name.
  return count ? `${count}.0` : ''
}

function normalizeLanguage(
  name?: string | null,
  code?: string | null,
  overrides?: Record<string, string>
): string {
  const base = (code ?? '').toLowerCase().split('-')[0] ?? ''
  if (base && overrides?.[base]) return overrides[base]
  return name || getLanguageDisplayName(code) || code || ''
}

// ---- filename parsers -----------------------------------------------------------------

export function parseTitleYear(filename: string): {
  title: string
  year: string
} {
  const base = filename.includes('.')
    ? filename.slice(0, filename.lastIndexOf('.'))
    : filename
  const clean = base.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim()
  const matches = [...clean.matchAll(/\b(19|20)\d{2}\b/g)]
  // Prefer the LAST year-like token so titled-year films (Blade Runner 2049) keep the
  // title and pick the release year, not the in-title number.
  const m = matches[matches.length - 1]
  const yearIdx = m && m.index !== undefined ? m.index : Infinity
  // For series without a year, the title ends at the SxxExx marker.
  const se = clean.match(/\bS\d{1,2}E\d{1,2}\b/i)
  const seIdx = se && se.index !== undefined ? se.index : Infinity
  let cut = Math.min(yearIdx, seIdx)
  if (cut === Infinity) {
    // No year and no SxxExx: fall back to the first technical token boundary so we don't
    // swallow the whole release string into the title.
    const tech = clean.match(
      /\b(2160p|1080p|720p|480p|4k|blu[\s.-]?ray|web[\s.-]?dl|webrip|hdrip|remux|uhd|x26[45]|h\.?26[45]|hevc|avc|vc-?1)\b/i
    )
    if (tech && tech.index !== undefined && tech.index > 0) cut = tech.index
  }
  const year = m && m.index !== undefined ? (m[0] ?? '') : ''
  if (cut === Infinity) return { title: clean, year }
  const title = clean
    .slice(0, cut)
    .replace(/[[({\s]+$/g, '')
    .trim()
  return { title: title || clean, year }
}

export function parseSeasonEpisode(filename: string): string {
  const clean = filename.replace(/[._]/g, ' ')
  const m = clean.match(/\bS(\d{1,2})E(\d{1,2})\b/i)
  if (!m || !m[1] || !m[2]) return ''
  return `S${m[1].padStart(2, '0')}E${m[2].padStart(2, '0')}`
}

const TECH_TOKEN =
  /^(x26[45]|h\.?26[45]|hevc|avc|av1|vp9|bluray|blu-ray|web|webdl|web-dl|webrip|hdrip|dvdrip|remux|uhd|4k|2160p|1080p|720p|480p|hdr|hdr10|dv|dovi|ddp?|dts|dts-hd|truehd|aac|flac|atmos|5|7|2|1|0)$/i

export function parseReleaseGroup(filename: string): string {
  const base = filename.includes('.')
    ? filename.slice(0, filename.lastIndexOf('.'))
    : filename
  // Only a hyphen-delimited trailing token is a release group. No hyphen → no group
  // (never grab the last dotted scene token like "BluRay" or "x264").
  const i = base.lastIndexOf('-')
  if (i < 0) return ''
  let cand = base
    .slice(i + 1)
    .replace(/[_\s-]*sample$/i, '')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '')
  // Two space-separated tags (e.g. "DarQ HONE") name the source group and the encoder; keep
  // only the last one ("HONE"), the actual encoder, and drop the leading release tag.
  if (/\s/.test(cand)) {
    cand = cand.split(/\s+/).filter(Boolean).pop() ?? ''
  }
  if (!cand || TECH_TOKEN.test(cand)) return ''
  return cand
}

function detectProvider(filename: string): string {
  // Pick the match that appears EARLIEST in the filename, not the first entry in the list —
  // list order is arbitrary, so "ATVP" would otherwise shadow "ATV" (and vice versa)
  // regardless of which one the name actually contains. Longer tags win a tie so "ATVP"
  // beats "ATV" at the same offset.
  let best = ''
  let bestIndex = Infinity
  for (const provider of WEB_PROVIDERS) {
    const match = new RegExp(
      `(^|[\\s._-])(${provider})([\\s._-]|$)`,
      'i'
    ).exec(filename)
    if (!match || match.index === undefined) continue
    const index = match.index + (match[1]?.length ?? 0)
    if (index < bestIndex || (index === bestIndex && provider.length > best.length)) {
      best = provider
      bestIndex = index
    }
  }
  return best
}

function detectSource(
  filename: string,
  resolution: string,
  override: PrintTypeOverride,
  derivedSource?: string | null
): string {
  if (override === 'WEB-DL') return 'WEB-DL'
  if (override === 'BluRay')
    return resolution === '2160p' ? 'UHD BluRay' : 'BluRay'
  const l = filename.toLowerCase()
  if (/web[\s._-]?dl/.test(l) || /\bwebdl\b/.test(l)) return 'WEB-DL'
  if (/webrip/.test(l)) return 'WEBRip'
  // Only an explicit BluRay token means BluRay. "UHD"/"2160p" alone is just the resolution
  // qualifier (it can equally be a WEB release), so it must NOT imply a disc source.
  if (/blu[\s._-]?ray/.test(l)) {
    return resolution === '2160p' || /\buhd\b/.test(l) ? 'UHD BluRay' : 'BluRay'
  }
  if (/\bweb\b/.test(l)) return 'WEB-DL'
  return derivedSource ?? ''
}

function resolutionFromFilename(filename: string): string {
  const l = filename.toLowerCase()
  const m = l.match(/\b(2160|1080|720|480)p\b/)
  if (m) return `${m[1]}p`
  // "UHD" / "4K" / a bare "2160" are all 2160p labels — recognize them so UHD prints from
  // any source are tagged even when the explicit "2160p" token is missing.
  if (/\b(?:4k|uhd|2160)\b/.test(l)) return '2160p'
  return ''
}

// ---- adapter --------------------------------------------------------------------------

/**
 * Build the audio parts in the analysis's own stream order, resolving Atmos.
 *
 * Atmos stated in the filename (e.g. "...TrueHD.7.1.Atmos.REMUX-GRP") backs up the stream
 * flags per the fallback priority (ffprobe -> tags -> filename): ffprobe often cannot see
 * Atmos, and retagging overwrites the track title it would otherwise be read from. It is
 * applied only to the highest-object-capable track so a 2.0 commentary never inherits it.
 *
 * Kept separate from `toParsedMedia` (which returns the *reordered* list) so track-title
 * builders can map the resolved flags back onto `analysis.audio` by index.
 */
function buildAudioParts(
  analysis: MediaAnalysis,
  filename: string,
  options: NamingOptions
): AudioPart[] {
  const audio: AudioPart[] = analysis.audio.map(stream => ({
    language: normalizeLanguage(
      stream.language.name,
      stream.language.code,
      options.languageOverrides
    ),
    langCode: (stream.language.code || '').toLowerCase().split('-')[0] ?? '',
    codec: mapAudioCodec(
      stream.codec.name,
      stream.codec.profile ?? stream.codec.long_name,
      options.audioCodecOverrides
    ),
    channels: normalizeChannels(stream.channels.count, stream.channels.layout),
    atmos: stream.flags.atmos,
    commentary: stream.flags.commentary ?? false,
  }))

  const filenameAtmos = /\batmos\b/i.test(filename)
  if (filenameAtmos && !audio.some(a => a.atmos)) {
    // Pick the track the filename is actually describing. Scene names state the codec and
    // channel layout alongside Atmos ("TrueHD.7.1.Atmos"), so match those first and fall
    // back to the widest Atmos-capable track. Commentary tracks are never eligible.
    const ATMOS_CODECS = ['TrueHD', 'DDP']
    const namedCodec = /\btrue[\s._-]?hd\b/i.test(filename)
      ? 'TrueHD'
      : /\b(ddp|dd\+|eac3|e-ac-3)\b/i.test(filename)
        ? 'DDP'
        : ''
    const namedChannels = filename.match(/\b(\d)[._](\d)\b/)
    const namedLayout = namedChannels
      ? `${namedChannels[1]}.${namedChannels[2]}`
      : ''

    // When the filename names a codec, only that codec is eligible. Otherwise any
    // Atmos-capable track is. This stops "TrueHD...Atmos" from tagging a DDP track when
    // the TrueHD track is missing or was mis-probed.
    const eligible = audio.filter(
      part =>
        !part.commentary &&
        ATMOS_CODECS.includes(part.codec) &&
        (!namedCodec || part.codec === namedCodec)
    )
    const score = (part: AudioPart) => {
      // Codec match is the strongest signal, then the stated channel layout.
      let value = 0
      if (namedCodec && part.codec === namedCodec) value += 4
      if (namedLayout && part.channels === namedLayout) value += 2
      value += (Number.parseFloat(part.channels) || 0) / 100
      return value
    }
    const best = eligible.reduce<AudioPart | undefined>(
      (winner, part) =>
        !winner || score(part) > score(winner) ? part : winner,
      undefined
    )
    if (best) best.atmos = true
  }

  return audio
}

/**
 * Per-stream Atmos, in `analysis.audio` order, with the filename fallback applied — so an
 * embedded track title can state Atmos on exactly the track the filename credits it to.
 */
export function resolveAudioAtmos(
  analysis: MediaAnalysis,
  options: NamingOptions = {}
): boolean[] {
  const filename = analysis.general.file.filename || ''
  return buildAudioParts(analysis, filename, options).map(part => part.atmos)
}

export function toParsedMedia(
  analysis: MediaAnalysis,
  options: NamingOptions = {}
): ParsedMedia {
  const filename = analysis.general.file.filename || ''
  const video = analysis.video[0]
  const derived = analysis.general.derived

  const { title: parsedTitle, year: parsedYear } = parseTitleYear(filename)
  const title = parsedTitle || derived.title || filename.replace(/\.[^.]+$/, '')
  // The "Remove year" option strips the year from the on-disk name only.
  const year = options.removeYear
    ? ''
    : parsedYear || (derived.year ? String(derived.year) : '')

  const resolution =
    video?.dimensions.resolution_tag ||
    derived.resolution_tag ||
    resolutionFromFilename(filename) ||
    ''

  const printType = options.printTypeOverride ?? ''
  const isRemux =
    /\bremux\b/i.test(filename) || derived.release_type === 'REMUX'
  let source = detectSource(filename, resolution, printType, derived.source)
  // A REMUX with no explicit source token is virtually always from a (UHD) BluRay disc.
  if (!source && isRemux) {
    source = resolution === '2160p' ? 'UHD BluRay' : 'BluRay'
  }
  const provider = detectProvider(filename)

  const bitDepth10 =
    (video?.pixel.bit_depth ?? 0) >= 10 || derived.bit_depth_tag === '10bit'

  const dvStyle = options.dvStyle ?? 'DoVi'
  let hdr = ''
  if (video?.hdr.is_dolby_vision) hdr = `${dvStyle} HDR`
  else if (video?.hdr.type === 'hdr10') hdr = 'HDR'
  else if (video?.hdr.type === 'hlg') hdr = 'HDR'
  // SDR / unknown -> '' (never emitted here; see `sdr` below)

  // SDR is only worth stating at 2160p, where HDR is the expectation — a 1080p SDR file is
  // unremarkable. Requires a *confirmed* non-HDR stream (`type === 'sdr'`) or an explicit SDR
  // token in the source name; `type === null` means undetected, which must stay silent so an
  // unanalysed file never gets falsely stamped SDR.
  const sdr =
    resolution === '2160p' &&
    !hdr &&
    (video?.hdr.type === 'sdr' || /\bsdr\b/i.test(filename))

  // videoFormat stays on the built-in mapping (drives the "10bit HEVC" descriptor);
  // only the final codec token honors the user override.
  const videoFormat = mapVideoFormat(video?.codec.name)
  const videoFinal = mapVideoFinal(
    video?.codec.name,
    options.videoCodecOverrides
  )

  const audio = buildAudioParts(analysis, filename, options)

  const orderedAudio = orderAudio(
    audio,
    options.languagePriority ?? ['hin', 'eng']
  )

  const group = options.group ?? parseReleaseGroup(filename)

  return {
    title,
    year,
    seasonEpisode: parseSeasonEpisode(filename),
    resolution,
    source,
    provider,
    isRemux,
    bitDepth10,
    hdr,
    sdr,
    videoFormat,
    videoFinal,
    audio: orderedAudio,
    group,
    ionicSuffix: options.ionicSuffix ?? 'Ionicboy',
  }
}

export function orderAudio(
  audio: AudioPart[],
  priority: string[]
): AudioPart[] {
  const rank = (p: AudioPart) => {
    const i = priority.findIndex(code => code.toLowerCase() === p.langCode)
    return i === -1 ? priority.length : i
  }
  return audio
    .map((part, index) => ({ part, index }))
    .sort((a, b) => rank(a.part) - rank(b.part) || a.index - b.index)
    .map(({ part }) => part)
}

// ---- renderers ------------------------------------------------------------------------

/**
 * Main (non-commentary) audio tracks. Falls back to the full list when EVERY track is
 * flagged commentary, so a misdetection can never erase the audio block entirely.
 */
export function mainAudio(audio: AudioPart[]): AudioPart[] {
  const main = audio.filter(a => !a.commentary)
  return main.length > 0 ? main : audio
}

/**
 * Build the muxed audio block, grouping tracks that share an identical codec / channel
 * layout / Atmos signature and combining their languages with hyphens. Five Indian DDP 5.1
 * tracks collapse to "Hindi-Tamil-Telugu-Kannada-Malayalam DDP 5.1"; a separate English
 * TrueHD 7.1 Atmos track stays its own "+"-joined group. Languages are de-duplicated within
 * a group so two same-language tracks never read "English-English".
 */
export function buildMuxedAudioBlock(audio: AudioPart[]): string {
  interface AudioGroup {
    languages: string[]
    codec: string
    channels: string
    atmos: boolean
  }
  const groups: AudioGroup[] = []
  const byKey = new Map<string, AudioGroup>()
  // Commentary / audio-description tracks are not part of the release's audio offering;
  // including them reads as a second main language track ("English ... + English DD 2.0").
  for (const a of mainAudio(audio)) {
    const key = `${a.codec}|${a.channels}|${a.atmos ? '1' : '0'}`
    let group = byKey.get(key)
    if (!group) {
      group = {
        languages: [],
        codec: a.codec,
        channels: a.channels,
        atmos: a.atmos,
      }
      byKey.set(key, group)
      groups.push(group)
    }
    if (a.language && !group.languages.includes(a.language)) {
      group.languages.push(a.language)
    }
  }
  return groups
    .map(g =>
      [g.languages.join('-'), g.codec, g.channels, g.atmos ? 'Atmos' : '']
        .filter(Boolean)
        .join(' ')
    )
    .filter(Boolean)
    .join(' + ')
}

// HDR / bit-depth descriptor (NOT the REMUX token, NOT the codec — builders place those).
// SDR occupies the same slot as HDR but, unlike HDR, does not suppress the bit-depth token:
// "SDR 10bit HEVC" carries strictly more information than either half alone.
function videoDescriptor(m: ParsedMedia): string {
  if (m.hdr) return m.hdr
  const range = m.sdr ? 'SDR' : ''
  const depth =
    !m.isRemux && m.bitDepth10 && m.videoFormat === 'HEVC'
      ? '10bit HEVC'
      : m.bitDepth10
        ? '10bit'
        : ''
  return [range, depth].filter(Boolean).join(' ')
}

export function buildMuxedFilename(m: ParsedMedia): string {
  const isWeb = m.source === 'WEB-DL' || m.source === 'WEBRip'
  // Encodes label the codec x264/x265; remuxes keep the actual format (AVC/HEVC/VC-1).
  const codec = m.isRemux ? m.videoFormat : m.videoFinal
  const videoBlock = [
    m.resolution,
    isWeb ? m.provider : '',
    m.source,
    videoDescriptor(m),
    // REMUX: "Source REMUX <codec>" before the audio block.
    m.isRemux ? 'REMUX' : '',
    m.isRemux ? codec : '',
  ]
    .filter(Boolean)
    .join(' ')
  const audioBlock = buildMuxedAudioBlock(m.audio)
  const group = [m.group, m.ionicSuffix].filter(Boolean).join('-')
  const titlePart = `${m.title}${m.year ? ` (${m.year})` : ''}${
    m.seasonEpisode ? ` ${m.seasonEpisode}` : ''
  }`
  return [
    titlePart,
    videoBlock,
    audioBlock ? `[${audioBlock}]` : '',
    // Encodes put the codec after the audio block; remuxes already placed it.
    m.isRemux ? '' : codec,
    group ? `(${group})` : '',
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildVodFilename(m: ParsedMedia): string {
  const isWeb = m.source === 'WEB-DL' || m.source === 'WEBRip'
  // Never let a commentary track become the single audio track named in a VOD filename.
  const a = mainAudio(m.audio)[0]
  const codec = m.isRemux ? m.videoFormat : m.videoFinal
  const audioTokens = a
    ? [a.language, a.codec, a.channels, a.atmos ? 'Atmos' : '']
    : []
  const tokens = [
    m.title,
    m.year,
    m.seasonEpisode,
    m.resolution,
    isWeb ? m.provider : '',
    m.source,
    videoDescriptor(m),
    // REMUX: "...Source REMUX <codec> Language Audio". Encode: codec goes after audio.
    ...(m.isRemux ? ['REMUX', codec] : []),
    ...audioTokens,
    ...(m.isRemux ? [] : [codec]),
  ]
    .filter(Boolean)
    .map(token => String(token).replace(/\s+/g, '.'))
  const base = tokens.join('.')
  return m.group ? `${base}-${m.group}` : base
}

export function resolveMode(
  m: ParsedMedia,
  mode: NamingMode = 'auto'
): NamingMode {
  if (mode === 'muxed' || mode === 'vod') return mode
  // Count only main tracks: a single-audio release with a commentary track is still a
  // single-audio (VOD-style) release, not a multi-audio mux.
  return mainAudio(m.audio).length <= 1 ? 'vod' : 'muxed'
}

/** Build the on-disk base name (no extension, unsanitized). */
export function buildOnDiskName(
  analysis: MediaAnalysis,
  options: NamingOptions = {}
): string {
  const parsed = toParsedMedia(analysis, options)
  const mode = resolveMode(parsed, options.mode ?? 'auto')
  return mode === 'vod' ? buildVodFilename(parsed) : buildMuxedFilename(parsed)
}

/**
 * Parse the tokens derivable from a filename ALONE (no stream data). Audio/codec/HDR come
 * from ffprobe and are intentionally absent here — this is for verifying title/year/group/
 * source/season parsing in the test-case runner.
 */
export function parseFilenameTokens(filename: string): {
  title: string
  year: string
  seasonEpisode: string
  resolution: string
  source: string
  group: string
} {
  const { title, year } = parseTitleYear(filename)
  const resolution = resolutionFromFilename(filename)
  return {
    title,
    year,
    seasonEpisode: parseSeasonEpisode(filename),
    resolution,
    source: detectSource(filename, resolution, '', null),
    group: parseReleaseGroup(filename),
  }
}

/** Compact labeled tokens for a before-rename preview of how the file was parsed. */
export function previewTokens(
  analysis: MediaAnalysis,
  options: NamingOptions = {}
): { label: string; value: string }[] {
  const p = toParsedMedia(analysis, options)
  const audio = p.audio
    .map(a =>
      [a.language, a.codec, a.channels, a.atmos ? 'Atmos' : '']
        .filter(Boolean)
        .join(' ')
    )
    .filter(Boolean)
    .join(', ')
  const pairs: { label: string; value: string }[] = [
    { label: 'Title', value: p.title },
    { label: 'Year', value: p.year },
    { label: 'Source', value: p.source },
    { label: 'Resolution', value: p.resolution },
    { label: 'HDR', value: p.hdr || (p.sdr ? 'SDR' : '') },
    { label: 'Codec', value: p.isRemux ? p.videoFormat : p.videoFinal },
    { label: 'Audio', value: audio },
    { label: 'Group', value: p.group },
  ]
  return pairs.filter(pair => pair.value)
}

/**
 * Advisory warnings to surface before rename/retag — things that are likely fine but
 * worth a glance (no language tag, missing group, unresolved resolution/title).
 */
export function collectNamingWarnings(
  analysis: MediaAnalysis,
  options: NamingOptions = {}
): string[] {
  const parsed = toParsedMedia(analysis, options)
  const warnings: string[] = []
  if (!parsed.title)
    warnings.push('Could not determine a title from the filename.')
  if (!parsed.year) warnings.push('No year detected.')
  if (!parsed.resolution) warnings.push('Resolution could not be determined.')
  const untagged = parsed.audio.filter(a => !a.language).length
  if (untagged > 0) {
    warnings.push(
      `${untagged} audio track${untagged > 1 ? 's have' : ' has'} no language tag.`
    )
  }
  if (!parsed.group && !options.group) {
    warnings.push('No release group detected in the filename.')
  }
  return warnings
}
