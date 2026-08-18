import type { MediaAnalysis } from '@/types/media-analysis'

/**
 * Test fixtures for naming logic.
 *
 * `makeAnalysis` builds a full `MediaAnalysis` object from high-level options and
 * computes the `general.derived.*` block and `audio[].derived.display_name` the same way
 * the Rust backend (`src-tauri/src/lib.rs::list_media_streams`) does *after Wave 1*
 * (i.e. SDR is no longer emitted). It is intentionally a faithful mirror of the current
 * backend — including known bugs — so the corpus snapshots reflect real runtime input and
 * make later waves' improvements visible as intended diffs.
 *
 * Raw ffprobe-level fields (codec names, color transfer, channel counts, language codes)
 * are also populated so the Wave 2 `naming-engine` can derive everything itself instead of
 * trusting the (buggy) `derived.*` strings.
 */

export interface AudioOpt {
  codec: string // ffprobe codec_name: 'eac3' | 'ac3' | 'dts' | 'truehd' | 'aac' | 'flac' | 'opus' | 'mp3' | 'pcm_s24le' | ...
  channels: number
  lang?: string | null // container language tag: 'eng' | 'hin' | null
  layout?: string | null // raw ffprobe channel_layout, e.g. '5.1(side)'
  atmos?: boolean
  profile?: string | null // e.g. 'DTS-HD MA'
  sampleRate?: number | null
  bitrate?: number | null
  bitDepth?: number | null // ffprobe bits_per_raw_sample/bits_per_sample (lossless only)
  commentary?: boolean // director's commentary / audio-description track
  title?: string | null // existing embedded track title
}

export interface SubtitleOpt {
  lang?: string | null
  codec?: string
  title?: string | null
  forced?: boolean
  sdh?: boolean
  default?: boolean
}

export interface FixtureOpt {
  path: string
  videoCodec?: string // 'h264' | 'hevc' | 'av1' | 'vp9'
  height?: number
  width?: number
  transfer?: string | null // 'bt709' | 'smpte2084' | 'arib-std-b67' | null
  bitDepth?: number | null
  dolbyVision?: boolean
  videoBitrate?: number | null
  audios?: AudioOpt[]
  subtitles?: SubtitleOpt[]
}

// ---- helpers mirroring src-tauri/src/lib.rs ------------------------------------------

const LANG_NAMES: Record<string, string> = {
  eng: 'English',
  en: 'English',
  hin: 'Hindi',
  hi: 'Hindi',
  tam: 'Tamil',
  tel: 'Telugu',
  jpn: 'Japanese',
  ja: 'Japanese',
  kor: 'Korean',
  spa: 'Spanish',
  fre: 'French',
  fra: 'French',
}

function getLanguageName(code?: string | null): string | null {
  if (!code) return null
  const base = code.toLowerCase().split('-')[0] ?? code.toLowerCase()
  return LANG_NAMES[base] ?? null
}

function getAudioCodecTag(codec: string): string | null {
  switch (codec.toLowerCase()) {
    case 'eac3':
      return 'DDP'
    case 'ac3':
      return 'DD'
    case 'truehd':
      return 'TrueHD'
    case 'aac':
      return 'AAC'
    case 'dts':
      return 'DTS'
    case 'flac':
      return 'FLAC'
    default:
      return null
  }
}

function getChannelLayout(
  count: number,
  layout?: string | null
): string | null {
  const mapped: Record<number, string> = {
    8: '7.1',
    6: '5.1',
    2: '2.0',
    1: '1.0',
  }
  const byCount = mapped[count]
  if (byCount) return byCount
  if (!layout) return null
  const cleaned = layout.split('(')[0]?.trim() ?? ''
  if (!cleaned) return null
  if (cleaned.toLowerCase() === 'stereo') return '2.0'
  if (cleaned.toLowerCase() === 'mono') return '1.0'
  return cleaned
}

function getResolutionTag(
  width: number,
  height: number
): '2160p' | '1080p' | null {
  // Mirrors the backend: bucket by the dominant dimension so letterboxed UHD/1080p keeps
  // its resolution via the width signal.
  if (width >= 3840 || height >= 2160) return '2160p'
  if (width >= 1920 || height >= 1080) return '1080p'
  return null
}

function getCodecTag(codec: string): 'x264' | 'x265' | null {
  if (codec === 'h264') return 'x264'
  if (codec === 'hevc') return 'x265'
  return null
}

function getSourceFromFilename(
  filename: string
): MediaAnalysis['general']['derived']['source'] {
  const lower = filename.toLowerCase()
  if (lower.includes('uhd bluray') || lower.includes('uhd blu-ray'))
    return 'UHD BluRay'
  if (lower.includes('bluray') || lower.includes('blu-ray')) return 'BluRay'
  if (
    lower.includes('web-dl') ||
    lower.includes('webdl') ||
    lower.includes('webrip')
  )
    return 'WEB-DL'
  return null
}

function parseTitleYear(filename: string): {
  title: string | null
  year: number | null
} {
  const base = filename.includes('.')
    ? filename.slice(0, filename.lastIndexOf('.'))
    : filename
  const clean = base.replace(/[._]/g, ' ').replace(/\s+/g, ' ')
  // NOTE: mirrors current backend bug — first year match wins.
  const m = clean.match(/\b(19|20)\d{2}\b/)
  if (!m) return { title: null, year: null }
  let part = clean.slice(0, m.index).trim()
  part = part.replace(/[[({\s]+$/g, '')
  return { title: part || null, year: Number(m[0]) }
}

function getReleaseGroup(filename: string): string | null {
  const base = filename.includes('.')
    ? filename.slice(0, filename.lastIndexOf('.'))
    : filename
  let candidate: string
  if (base.includes('-')) candidate = base.slice(base.lastIndexOf('-') + 1)
  else if (base.includes('.')) candidate = base.slice(base.lastIndexOf('.') + 1)
  else candidate = base
  const cleaned = candidate
    .replace(/[_\s-]*sample$/i, '')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '')
  return cleaned || null
}

function isRemux(filename: string): boolean {
  return filename.toLowerCase().includes('remux')
}

// ---- factory --------------------------------------------------------------------------

export function makeAnalysis(opt: FixtureOpt): MediaAnalysis {
  const filename = opt.path.split(/[/\\]/).pop() ?? opt.path
  const extension = filename.includes('.')
    ? filename.slice(filename.lastIndexOf('.') + 1)
    : ''
  const videoCodec = opt.videoCodec ?? 'h264'
  const height = opt.height ?? 1080
  const width = opt.width ?? (height >= 2160 ? 3840 : 1920)
  const transfer = opt.transfer === undefined ? 'bt709' : opt.transfer
  const bitDepth = opt.bitDepth ?? 8
  const dv = opt.dolbyVision ?? false
  const audios = opt.audios ?? [{ codec: 'eac3', channels: 6, lang: 'eng' }]
  const subtitles = opt.subtitles ?? []

  const resolutionTag = getResolutionTag(width, height)
  const codecTag = getCodecTag(videoCodec)
  const source = getSourceFromFilename(filename)
  const { title, year } = parseTitleYear(filename)

  // hdr_tag mirrors backend AFTER Wave 1 (no SDR branch).
  const hdrTag: MediaAnalysis['general']['derived']['hdr_tag'] = dv
    ? 'DoVi HDR'
    : transfer === 'smpte2084' || transfer === 'arib-std-b67'
      ? 'HDR'
      : null

  const releaseType: MediaAnalysis['general']['derived']['release_type'] =
    isRemux(filename)
      ? 'REMUX'
      : opt.videoBitrate
        ? opt.videoBitrate >= 30_000_000
          ? 'REMUX'
          : 'Encode'
        : null

  const hdrType: MediaAnalysis['video'][number]['hdr']['type'] = dv
    ? 'dolby_vision'
    : transfer === 'smpte2084'
      ? 'hdr10'
      : transfer === 'arib-std-b67'
        ? 'hlg'
        : transfer
          ? 'sdr'
          : null

  const video: MediaAnalysis['video'] = [
    {
      stream_index: 0,
      codec: {
        name: videoCodec,
        long_name: videoCodec === 'hevc' ? 'H.265 / HEVC' : 'H.264 / AVC',
        profile: videoCodec === 'hevc' ? 'Main 10' : 'High',
        level: 41,
      },
      dimensions: { width, height, resolution_tag: resolutionTag },
      bitrate: { bitrate: opt.videoBitrate ?? null, max_bitrate: null },
      frame_rate: { avg: '24000/1001', real: 23.976 },
      pixel: {
        pixel_format: bitDepth >= 10 ? 'yuv420p10le' : 'yuv420p',
        bit_depth: bitDepth,
      },
      color: {
        primaries: height >= 2160 ? 'bt2020' : 'bt709',
        transfer,
        matrix: height >= 2160 ? 'bt2020nc' : 'bt709',
      },
      hdr: {
        type: hdrType,
        is_hdr:
          hdrType === 'dolby_vision' ||
          hdrType === 'hdr10' ||
          hdrType === 'hlg',
        is_dolby_vision: dv,
        dolby_vision: { profile: dv ? '8.1' : null, level: dv ? '6' : null },
        hdr10: { mastering_display: transfer === 'smpte2084', max_cll: null },
      },
      derived: {
        source_type:
          source ?? (resolutionTag === '2160p' ? 'UHD BluRay' : 'BluRay'),
        encode_type: releaseType,
      },
    },
  ]

  const audio: MediaAnalysis['audio'] = audios.map((a, i) => {
    const langName = getLanguageName(a.lang)
    const codecTagA = getAudioCodecTag(a.codec)
    const layout = getChannelLayout(a.channels, a.layout)
    const displayName =
      langName && codecTagA && layout
        ? `${langName} ${codecTagA} ${layout}${a.atmos ? ' Atmos' : ''}`
        : null
    return {
      stream_index: i + 1,
      title: a.title ?? null,
      codec: { name: a.codec, long_name: a.codec, profile: a.profile ?? null },
      channels: { count: a.channels, layout: a.layout ?? null },
      bitrate: a.bitrate ?? null,
      sample_rate: a.sampleRate ?? 48000,
      bit_depth: a.bitDepth ?? null,
      language: { code: a.lang ?? null, name: langName },
      flags: {
        atmos: a.atmos ?? false,
        lossless: a.codec === 'truehd' || a.codec === 'flac',
        commentary: a.commentary ?? false,
      },
      derived: { display_name: displayName },
    }
  })

  const subs: MediaAnalysis['subtitles'] = subtitles.map((s, i) => ({
    stream_index: audio.length + i + 1,
    codec: s.codec ?? 'subrip',
    title: s.title ?? null,
    language: { code: s.lang ?? null, name: getLanguageName(s.lang) },
    flags: {
      forced: s.forced ?? false,
      default: s.default ?? false,
      hearing_impaired: s.sdh ?? false,
    },
  }))

  return {
    general: {
      container: {
        format_name: 'matroska,webm',
        duration_seconds: 7200,
        size_bytes: 8_000_000_000,
        overall_bitrate: 8_000_000,
      },
      file: { path: opt.path, filename, extension },
      derived: {
        title,
        year,
        source,
        release_type: releaseType,
        resolution_tag: resolutionTag,
        codec_tag: codecTag,
        bit_depth_tag: bitDepth >= 10 ? '10bit' : null,
        hdr_tag: hdrTag,
        release_group: getReleaseGroup(filename),
      },
    },
    video,
    audio,
    subtitles: subs,
  }
}

// ---- 13-case corpus (audit §H test plan) ---------------------------------------------

export const CORPUS = {
  // Case 1 / 2: Inception with English audio (muxed adds Hindi)
  inception_single: {
    path: '/m/Inception.2018.1080p.BluRay.DDP.5.1.x264-RaZoR.mkv',
    videoCodec: 'h264',
    height: 1080,
    transfer: 'bt709',
    audios: [{ codec: 'eac3', channels: 6, lang: 'eng' }],
  },
  inception_muxed: {
    path: '/m/Inception.2018.1080p.BluRay.DDP.5.1.x264-RaZoR.mkv',
    videoCodec: 'h264',
    height: 1080,
    transfer: 'bt709',
    audios: [
      { codec: 'eac3', channels: 6, lang: 'hin' },
      { codec: 'eac3', channels: 6, lang: 'eng' },
    ],
  },
  // Case 3: 10-bit HEVC BluRay
  hevc_10bit: {
    path: '/m/The.Movie.2020.1080p.BluRay.10bit.x265-Group.mkv',
    videoCodec: 'hevc',
    height: 1080,
    transfer: 'bt709',
    bitDepth: 10,
    audios: [
      { codec: 'eac3', channels: 6, lang: 'hin' },
      { codec: 'eac3', channels: 6, lang: 'eng' },
    ],
  },
  // Case 4: 2160p HDR10
  uhd_hdr10: {
    path: '/m/The.Movie.2021.2160p.UHD.BluRay.HDR.x265-Group.mkv',
    videoCodec: 'hevc',
    height: 2160,
    transfer: 'smpte2084',
    bitDepth: 10,
    audios: [
      { codec: 'eac3', channels: 6, lang: 'hin' },
      { codec: 'eac3', channels: 6, lang: 'eng' },
    ],
  },
  // Case 5: 2160p DV + HDR
  uhd_dv: {
    path: '/m/The.Movie.2021.2160p.UHD.BluRay.DV.HDR.x265-Group.mkv',
    videoCodec: 'hevc',
    height: 2160,
    transfer: 'smpte2084',
    bitDepth: 10,
    dolbyVision: true,
    audios: [
      { codec: 'eac3', channels: 6, lang: 'hin' },
      { codec: 'eac3', channels: 6, lang: 'eng' },
    ],
  },
  // Case 7: short title "Up"
  up: {
    path: '/m/Up.2009.1080p.BluRay.DDP.5.1.x264-Group.mkv',
    videoCodec: 'h264',
    height: 1080,
    transfer: 'bt709',
    audios: [{ codec: 'eac3', channels: 6, lang: 'eng' }],
  },
  // Case 8: "Her" with AAC 2.0
  her: {
    path: '/m/Her.2013.1080p.BluRay.AAC.2.0.x264-Group.mkv',
    videoCodec: 'h264',
    height: 1080,
    transfer: 'bt709',
    audios: [{ codec: 'aac', channels: 2, lang: 'eng' }],
  },
  // Case 9: title containing a year (Blade Runner 2049)
  blade_runner_2049: {
    path: '/m/Blade.Runner.2049.2017.2160p.UHD.BluRay.x265-Group.mkv',
    videoCodec: 'hevc',
    height: 2160,
    transfer: 'smpte2084',
    bitDepth: 10,
    audios: [{ codec: 'truehd', channels: 8, lang: 'eng', atmos: true }],
  },
  // Case 10: no hyphen release group
  no_group: {
    path: '/m/Inception.2018.1080p.BluRay.x264.mkv',
    videoCodec: 'h264',
    height: 1080,
    transfer: 'bt709',
    audios: [{ codec: 'eac3', channels: 6, lang: 'eng' }],
  },
  // Case 12: DTS-HD MA track (profile-disambiguated)
  dts_hd_ma: {
    path: '/m/The.Movie.2018.1080p.BluRay.DTS-HD.MA.7.1-Group.mkv',
    videoCodec: 'h264',
    height: 1080,
    transfer: 'bt709',
    audios: [{ codec: 'dts', channels: 8, lang: 'eng', profile: 'DTS-HD MA' }],
  },
  // Case 13: audio with no language tag
  untagged_audio: {
    path: '/m/The.Movie.2018.1080p.BluRay.x264-Group.mkv',
    videoCodec: 'h264',
    height: 1080,
    transfer: 'bt709',
    audios: [{ codec: 'eac3', channels: 6, lang: null }],
  },
  // Extra: PCM track (currently dropped)
  pcm_audio: {
    path: '/m/Concert.2018.1080p.BluRay.LPCM.2.0-Group.mkv',
    videoCodec: 'h264',
    height: 1080,
    transfer: 'bt709',
    audios: [{ codec: 'pcm_s24le', channels: 2, lang: 'eng' }],
  },
} satisfies Record<string, FixtureOpt>
