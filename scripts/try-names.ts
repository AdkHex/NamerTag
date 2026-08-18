/**
 * Name-only test harness for the naming engine.
 *
 * Two modes:
 *   1. Filename mode — pass bare names. Only what a filename can prove is shown
 *      (title/year/SxxExx/resolution/source/group). Audio, HDR and codec come from
 *      ffprobe, so they are absent here by design.
 *   2. Real-file mode — pass paths to actual media files. ffprobe is invoked and the
 *      FULL pipeline runs: generated filename, container title and every track title,
 *      exactly as the app's Generate button would produce them.
 *
 * Usage:
 *   pnpm names "Movie.2024.2160p.WEB-DL.DDP5.1.x265-GRP.mkv"
 *   pnpm names --file /path/to/real.mkv
 *   pnpm names --samples          # built-in corpus of tricky release names
 *   pnpm names --file /media/*.mkv --json
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  buildOnDiskName,
  parseFilenameTokens,
  previewTokens,
  collectNamingWarnings,
} from '../src/lib/naming-engine'
import { buildGeneratedNameDraft } from '../src/lib/naming'
import type { MediaAnalysis } from '../src/types/media-analysis'

// Release names that exercise the parsing edge cases the engine has to get right.
const SAMPLES = [
  'Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC.TrueHD.7.1.Atmos-FraMeSToR.mkv',
  'Oppenheimer.2023.1080p.MAX.WEB-DL.DDP5.1.Atmos.H.264-FLUX.mkv',
  'The.Matrix.1999.2160p.UHD.BluRay.x265.10bit.HDR.DTS-HD.MA.5.1-SWTYBLZ.mkv',
  'Blade.Runner.2049.2017.2160p.UHD.BluRay.REMUX.DV.HEVC.TrueHD.7.1-playBD.mkv',
  'Sherlock.S01E01.A.Study.in.Pink.1080p.BluRay.REMUX.AVC.DTS-HD.MA.5.1-NOGRP.mkv',
  'Kalki.2898.AD.2024.1080p.NF.WEB-DL.Hindi-Telugu.DDP5.1.x264-Ionicboy.mkv',
  'Furiosa.2024.2160p.AMZN.WEB-DL.DDP5.1.Atmos.HDR.H.265-FLUX.mkv',
  'Some.Show.2021.1080p.ATV.WEB-DL.DDP5.1.H.264-GRP.mkv',
  'Old.Film.1965.720p.BluRay.x264.mkv',
]

const GREEN = '\x1b[32m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const YELLOW = '\x1b[33m'
const RESET = '\x1b[0m'

function probe(path: string): MediaAnalysis | null {
  let raw: string
  try {
    raw = execFileSync(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', path],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
    )
  } catch {
    console.error(`${YELLOW}! ffprobe failed for${RESET} ${path}`)
    return null
  }
  const json = JSON.parse(raw) as {
    streams?: Record<string, unknown>[]
    format?: Record<string, unknown>
  }
  const streams = json.streams ?? []
  const filename = path.split(/[/\\]/).pop() ?? path
  const num = (v: unknown) =>
    typeof v === 'number' ? v : typeof v === 'string' ? Number(v) || null : null
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  const kind = (s: Record<string, unknown>) => str(s.codec_type) ?? ''
  const disposition = (s: Record<string, unknown>, key: string) =>
    (s.disposition as Record<string, number> | undefined)?.[key] === 1
  const tag = (s: Record<string, unknown>, key: string) =>
    str((s.tags as Record<string, unknown> | undefined)?.[key])

  const video = streams
    .filter(s => kind(s) === 'video' && !disposition(s, 'attached_pic'))
    .map(s => {
      const width = num(s.width)
      const height = num(s.height)
      const transfer = str(s.color_transfer)
      const dv = Array.isArray(s.side_data_list)
        ? (s.side_data_list as Record<string, unknown>[]).some(d =>
            String(d.side_data_type ?? '').includes('DOVI')
          )
        : false
      const pixDepth = str(s.pix_fmt)?.match(/p(\d{2})/)?.[1]
      const depth = num(s.bits_per_raw_sample) ?? (pixDepth ? Number(pixDepth) : null)
      const resTag =
        width && width >= 3840 ? '2160p' : width && width >= 1920 ? '1080p' : null
      return {
        stream_index: num(s.index) ?? 0,
        codec: {
          name: str(s.codec_name),
          long_name: str(s.codec_long_name),
          profile: str(s.profile),
          level: num(s.level),
        },
        dimensions: { width, height, resolution_tag: resTag },
        bitrate: { bitrate: num(s.bit_rate), max_bitrate: null },
        frame_rate: { avg: str(s.avg_frame_rate), real: null },
        pixel: { pixel_format: str(s.pix_fmt), bit_depth: depth },
        color: {
          primaries: str(s.color_primaries),
          transfer,
          matrix: str(s.color_space),
        },
        hdr: {
          type: dv
            ? ('dolby_vision' as const)
            : transfer === 'smpte2084'
              ? ('hdr10' as const)
              : transfer === 'arib-std-b67'
                ? ('hlg' as const)
                : null,
          is_hdr: dv || transfer === 'smpte2084' || transfer === 'arib-std-b67',
          is_dolby_vision: dv,
          dolby_vision: { profile: null, level: null },
          hdr10: { mastering_display: false, max_cll: null },
        },
        derived: { source_type: null, encode_type: null },
      }
    }) as MediaAnalysis['video']

  const audio = streams
    .filter(s => kind(s) === 'audio')
    .map(s => {
      const codec = str(s.codec_name)
      const profile = str(s.profile)
      const title = tag(s, 'title')?.toLowerCase() ?? null
      const joc = Array.isArray(s.side_data_list)
        ? (s.side_data_list as Record<string, unknown>[]).some(
            d =>
              String(d.side_data_type ?? '')
                .toLowerCase()
                .includes('joc') || Number(d.complexity_index ?? 0) > 0
          )
        : false
      const mentions = (v: string | null) =>
        !!v && (/atmos/i.test(v) || /joc/i.test(v))
      const atmos =
        ['truehd', 'mlp', 'eac3'].includes((codec ?? '').toLowerCase()) &&
        (mentions(profile) || mentions(str(s.codec_long_name)) || joc || mentions(title))
      const c = (codec ?? '').toLowerCase()
      const lossless =
        c.startsWith('pcm') ||
        ['truehd', 'mlp', 'flac', 'alac'].includes(c) ||
        (c === 'dts' && /\b(ma|master)\b/i.test(profile ?? ''))
      return {
        stream_index: num(s.index) ?? 0,
        title: tag(s, 'title'),
        codec: { name: codec, long_name: str(s.codec_long_name), profile },
        channels: { count: num(s.channels), layout: str(s.channel_layout) },
        bitrate: num(s.bit_rate),
        sample_rate: num(s.sample_rate),
        bit_depth: num(s.bits_per_raw_sample) ?? num(s.bits_per_sample),
        language: { code: tag(s, 'language'), name: null },
        flags: {
          atmos,
          lossless,
          commentary:
            disposition(s, 'comment') ||
            disposition(s, 'visual_impaired') ||
            /commentary|description|descriptive/i.test(title ?? ''),
        },
        derived: { display_name: null },
      }
    }) as MediaAnalysis['audio']

  const subtitles = streams
    .filter(s => kind(s) === 'subtitle')
    .map(s => ({
      stream_index: num(s.index) ?? 0,
      codec: str(s.codec_name),
      title: tag(s, 'title'),
      language: { code: tag(s, 'language'), name: null },
      flags: {
        forced: disposition(s, 'forced'),
        default: disposition(s, 'default'),
        hearing_impaired: disposition(s, 'hearing_impaired'),
      },
    })) as MediaAnalysis['subtitles']

  return {
    general: {
      container: {
        format_name: str(json.format?.format_name),
        duration_seconds: num(json.format?.duration),
        size_bytes: num(json.format?.size),
        overall_bitrate: num(json.format?.bit_rate),
      },
      file: {
        path,
        filename,
        extension: filename.split('.').slice(1).pop() ?? null,
      },
      derived: {
        title: null,
        year: null,
        source: null,
        release_type: null,
        resolution_tag: null,
        codec_tag: null,
        bit_depth_tag: null,
        hdr_tag: null,
        release_group: null,
      },
    },
    video,
    audio,
    subtitles,
  }
}

function reportFilename(name: string) {
  const t = parseFilenameTokens(name)
  console.log(`${DIM}in ${RESET}${name}`)
  const pairs: [string, string][] = [
    ['Title', t.title],
    ['Year', t.year],
    ['Episode', t.seasonEpisode],
    ['Resolution', t.resolution],
    ['Source', t.source],
    ['Group', t.group],
  ]
  console.log(
    '   ' +
      pairs
        .filter(([, v]) => v)
        .map(([k, v]) => `${DIM}${k}${RESET} ${v}`)
        .join(`${DIM}  ·  ${RESET}`)
  )
  console.log()
}

function reportFile(path: string) {
  const analysis = probe(path)
  if (!analysis) return
  const draft = buildGeneratedNameDraft(analysis)
  console.log(`${DIM}in  ${RESET}${analysis.general.file.filename}`)
  console.log(`${GREEN}out ${BOLD}${draft.generatedName}${RESET}`)
  console.log(`${DIM}    container ${RESET}${draft.videoTitleText}`)
  for (const v of draft.videoTitles) console.log(`${DIM}    video     ${RESET}${v}`)
  for (const a of draft.audioTitles) console.log(`${DIM}    audio     ${RESET}${a}`)
  for (const s of draft.subtitleTitles)
    console.log(`${DIM}    subtitle  ${RESET}${s}`)
  const tokens = previewTokens(analysis)
  console.log(
    `${DIM}    parsed    ${RESET}` +
      tokens.map(t => `${DIM}${t.label}${RESET} ${t.value}`).join(`${DIM} · ${RESET}`)
  )
  for (const w of collectNamingWarnings(analysis)) {
    console.log(`${YELLOW}    ! ${w}${RESET}`)
  }
  console.log()
}

function main() {
  const argv = process.argv.slice(2)
  const json = argv.includes('--json')
  const fileMode = argv.includes('--file')
  const useSamples = argv.includes('--samples')
  const inputs = argv.filter(a => !a.startsWith('--'))
  const targets = useSamples ? SAMPLES : inputs

  if (targets.length === 0) {
    console.log(`Usage:
  pnpm names "Movie.2024.2160p.WEB-DL.DDP5.1.x265-GRP.mkv"   parse a name
  pnpm names --samples                                       built-in tricky names
  pnpm names --file /path/to/real.mkv                        full pipeline via ffprobe
  pnpm names --file /media/*.mkv --json                       machine-readable output`)
    process.exit(1)
  }

  if (json) {
    const out = targets.map(t => {
      if (fileMode) {
        const a = probe(t)
        if (!a) return { input: t, error: 'ffprobe failed' }
        const d = buildGeneratedNameDraft(a)
        return {
          input: t,
          generatedName: d.generatedName,
          containerTitle: d.videoTitleText,
          videoTitles: d.videoTitles,
          audioTitles: d.audioTitles,
          subtitleTitles: d.subtitleTitles,
          warnings: collectNamingWarnings(a),
        }
      }
      return { input: t, ...parseFilenameTokens(t) }
    })
    console.log(JSON.stringify(out, null, 2))
    return
  }

  console.log()
  for (const target of targets) {
    if (fileMode) {
      if (!existsSync(target)) {
        console.error(`${YELLOW}! not found${RESET} ${target}\n`)
        continue
      }
      reportFile(target)
    } else {
      reportFilename(target)
    }
  }

  if (!fileMode) {
    console.log(
      `${DIM}Filename mode shows only what a name can prove. Audio, HDR and codec come\n` +
        `from the file itself — use --file <path> to run the full pipeline.${RESET}\n`
    )
  }
}

main()

// Also expose buildOnDiskName so the import is meaningful for programmatic use.
export { buildOnDiskName }
