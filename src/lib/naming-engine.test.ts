import { describe, expect, it } from 'vitest'
import {
  buildMuxedAudioBlock,
  buildOnDiskName,
  collectNamingWarnings,
  mapAudioCodec,
  mapVideoFinal,
  normalizeChannels,
  parseFilenameTokens,
  parseReleaseGroup,
  parseTitleYear,
  previewTokens,
  toParsedMedia,
} from './naming-engine'
import { buildGeneratedNameDraft, classifySubtitle } from './naming'
import { CORPUS, makeAnalysis } from './__fixtures__/media-analysis'
import { defaultPreferences, NO_TAG } from '@/types/preferences'

describe('mappers', () => {
  it('maps video to final codec', () => {
    expect(mapVideoFinal('h264')).toBe('x264')
    expect(mapVideoFinal('hevc')).toBe('x265')
    expect(mapVideoFinal('av1')).toBe('AV1')
    expect(mapVideoFinal('vp9')).toBe('VP9')
  })

  it('maps audio codecs incl. DTS profile, PCM, Opus', () => {
    expect(mapAudioCodec('eac3')).toBe('DDP')
    expect(mapAudioCodec('ac3')).toBe('DD')
    expect(mapAudioCodec('truehd')).toBe('TrueHD')
    expect(mapAudioCodec('dts')).toBe('DTS')
    expect(mapAudioCodec('dts', 'DTS-HD MA')).toBe('DTS-HD MA')
    expect(mapAudioCodec('dts', 'DTS:X')).toBe('DTS:X')
    expect(mapAudioCodec('pcm_s24le')).toBe('PCM')
    expect(mapAudioCodec('opus')).toBe('Opus')
    expect(mapAudioCodec('mp3')).toBe('MP3')
  })

  it('normalizes channels', () => {
    expect(normalizeChannels(8)).toBe('7.1')
    expect(normalizeChannels(6)).toBe('5.1')
    expect(normalizeChannels(2)).toBe('2.0')
    expect(normalizeChannels(1)).toBe('1.0')
    expect(normalizeChannels(7)).toBe('6.1')
  })
})

describe('parsers', () => {
  it('parseTitleYear prefers the last year (titled-year films)', () => {
    expect(
      parseTitleYear('Inception.2018.1080p.BluRay.x264-RaZoR.mkv')
    ).toEqual({
      title: 'Inception',
      year: '2018',
    })
    expect(
      parseTitleYear('Blade.Runner.2049.2017.2160p.UHD.BluRay.x265-Group.mkv')
    ).toEqual({ title: 'Blade Runner 2049', year: '2017' })
  })

  it('parseTitleYear cuts at SxxExx when there is no year (series)', () => {
    expect(
      parseTitleYear(
        'Rick.and.Morty.S01E01.Pilot.1080p.TrueHD.5.1.VC-1.REMUX-FraMeSToR.mkv'
      )
    ).toEqual({ title: 'Rick and Morty', year: '' })
  })

  it('parseTitleYear keeps the year for a series that has one', () => {
    expect(
      parseTitleYear('Rick.and.Morty.2013.S01E07.1080p.BluRay.x265-Group.mkv')
    ).toEqual({ title: 'Rick and Morty', year: '2013' })
  })

  it('parseTitleYear excludes SxxExx even when it precedes the year', () => {
    // Prevents the embedded title from doubling SxxExx (e.g. "... (2018) S01E01" not
    // "... S01E01 (2018) S01E01").
    expect(
      parseTitleYear(
        'Inception.S01E01.2018.1080p.BluRay.DDP.5.1.x264-RaZoR.mkv'
      )
    ).toEqual({ title: 'Inception', year: '2018' })
  })

  it('bare UHD / 2160p does not imply BluRay (could be WEB)', () => {
    expect(parseFilenameTokens('Inception.2018.2160p.UHD.mkv').source).toBe('')
    expect(
      parseFilenameTokens('Movie.2018.2160p.UHD.BluRay.x265-G.mkv').source
    ).toBe('UHD BluRay')
    expect(
      parseFilenameTokens('Show.2018.2160p.WEB-DL.x265-G.mkv').source
    ).toBe('WEB-DL')
  })

  it('parseReleaseGroup only accepts a hyphen-delimited non-tech token', () => {
    expect(
      parseReleaseGroup('Inception.2018.1080p.BluRay.x264-RaZoR.mkv')
    ).toBe('RaZoR')
    expect(parseReleaseGroup('Inception.2018.1080p.BluRay.x264.mkv')).toBe('')
    expect(parseReleaseGroup('Inception.2018.1080p.BluRay.mkv')).toBe('')
    expect(parseReleaseGroup('Movie.2018.1080p.BluRay-x264.mkv')).toBe('') // tech token rejected
  })
})

describe('target filename outputs (audit §H)', () => {
  const cases: Record<string, string> = {
    // Case 1: muxed (2 audios, Hindi-first; same codec/layout → languages combined)
    inception_muxed:
      'Inception (2018) 1080p BluRay [Hindi-English DDP 5.1] x264 (RaZoR-Ionicboy)',
    // Case 2: VOD (single audio, dotted, language before codec)
    inception_single: 'Inception.2018.1080p.BluRay.English.DDP.5.1.x264-RaZoR',
    // Case 3: 10-bit HEVC
    hevc_10bit:
      'The Movie (2020) 1080p BluRay 10bit HEVC [Hindi-English DDP 5.1] x265 (Group-Ionicboy)',
    // Case 4: 2160p UHD BluRay HDR
    uhd_hdr10:
      'The Movie (2021) 2160p UHD BluRay HDR [Hindi-English DDP 5.1] x265 (Group-Ionicboy)',
    // Case 5: 2160p UHD BluRay DoVi HDR
    uhd_dv:
      'The Movie (2021) 2160p UHD BluRay DoVi HDR [Hindi-English DDP 5.1] x265 (Group-Ionicboy)',
    // Case 7: short title preserved
    up: 'Up.2009.1080p.BluRay.English.DDP.5.1.x264-Group',
    // Case 8: "Her" + AAC 2.0
    her: 'Her.2013.1080p.BluRay.English.AAC.2.0.x264-Group',
    // Case 10: no release group -> no trailing group token (not "x264")
    no_group: 'Inception.2018.1080p.BluRay.English.DDP.5.1.x264',
    // Case 12: DTS-HD MA disambiguated
    dts_hd_ma: 'The.Movie.2018.1080p.BluRay.English.DTS-HD.MA.7.1.x264-Group',
    // Case 13: untagged audio kept (no language token, track not dropped)
    untagged_audio: 'The.Movie.2018.1080p.BluRay.DDP.5.1.x264-Group',
    // Extra: PCM kept
    pcm_audio: 'Concert.2018.1080p.BluRay.English.PCM.2.0.x264-Group',
  }

  for (const [name, expected] of Object.entries(cases)) {
    it(`${name} (auto mode)`, () => {
      const opt = CORPUS[name as keyof typeof CORPUS]
      if (!opt) throw new Error(`missing corpus case: ${name}`)
      expect(buildOnDiskName(makeAnalysis(opt))).toBe(expected)
    })
  }

  it('Case 9: Blade Runner 2049 keeps title + correct year (forced muxed)', () => {
    expect(
      buildOnDiskName(makeAnalysis(CORPUS.blade_runner_2049), { mode: 'muxed' })
    ).toBe(
      'Blade Runner 2049 (2017) 2160p UHD BluRay HDR [English TrueHD 7.1 Atmos] x265 (Group-Ionicboy)'
    )
  })

  it('REMUX series VOD: REMUX + format codec before audio, no-year title', () => {
    const analysis = makeAnalysis({
      path: 'Rick.and.Morty.S01E01.Pilot.1080p.TrueHD.5.1.VC-1.REMUX-FraMeSToR.mkv',
      videoCodec: 'vc1',
      height: 1080,
      transfer: 'bt709',
      audios: [
        { codec: 'truehd', channels: 6, lang: 'eng' },
        { codec: 'ac3', channels: 6, lang: 'eng' },
        { codec: 'ac3', channels: 2, lang: 'eng' },
      ],
    })
    expect(buildOnDiskName(analysis, { mode: 'vod' })).toBe(
      'Rick.and.Morty.S01E01.1080p.BluRay.REMUX.VC-1.English.TrueHD.5.1-FraMeSToR'
    )
  })

  it('Case 6: single-audio auto-detects VOD; forced muxed still works', () => {
    expect(buildOnDiskName(makeAnalysis(CORPUS.up))).toMatch(/^Up\.2009/) // dotted = VOD
    expect(
      buildOnDiskName(makeAnalysis(CORPUS.up), { mode: 'muxed' })
    ).toContain('[English DDP 5.1]')
  })
})

describe('audio grouping (shared codec/layout → combined languages)', () => {
  const part = (
    language: string,
    langCode: string,
    codec: string,
    channels: string,
    atmos = false
  ) => ({ language, langCode, codec, channels, atmos })

  it('combines two same-codec languages into one block', () => {
    expect(
      buildMuxedAudioBlock([
        part('Hindi', 'hin', 'DDP', '5.1'),
        part('English', 'eng', 'DDP', '5.1'),
      ])
    ).toBe('Hindi-English DDP 5.1')
  })

  it('keeps a differing codec/layout/Atmos track as its own group', () => {
    expect(
      buildMuxedAudioBlock([
        part('Hindi', 'hin', 'DDP', '5.1'),
        part('English', 'eng', 'DDP', '5.1'),
        part('English', 'eng', 'TrueHD', '7.1', true),
      ])
    ).toBe('Hindi-English DDP 5.1 + English TrueHD 7.1 Atmos')
  })

  it('groups five regional DDP 5.1 tracks, splitting the Atmos English track', () => {
    expect(
      buildMuxedAudioBlock([
        part('Hindi', 'hin', 'DDP', '5.1'),
        part('Tamil', 'tam', 'DDP', '5.1'),
        part('Telugu', 'tel', 'DDP', '5.1'),
        part('Kannada', 'kan', 'DDP', '5.1'),
        part('Malayalam', 'mal', 'DDP', '5.1'),
        part('English', 'eng', 'DDP', '5.1', true),
      ])
    ).toBe(
      'Hindi-Tamil-Telugu-Kannada-Malayalam DDP 5.1 + English DDP 5.1 Atmos'
    )
  })

  it('de-duplicates repeated languages within a group', () => {
    expect(
      buildMuxedAudioBlock([
        part('English', 'eng', 'DDP', '5.1'),
        part('English', 'eng', 'DDP', '5.1'),
      ])
    ).toBe('English DDP 5.1')
  })

  it('flows through the full muxed name for a 3-audio mix', () => {
    const analysis = makeAnalysis({
      path: '/m/Movie.2021.2160p.UHD.BluRay.x265-Group.mkv',
      videoCodec: 'hevc',
      height: 2160,
      transfer: 'smpte2084',
      bitDepth: 10,
      audios: [
        { codec: 'eac3', channels: 6, lang: 'hin' },
        { codec: 'eac3', channels: 6, lang: 'eng' },
        { codec: 'truehd', channels: 8, lang: 'eng', atmos: true },
      ],
    })
    expect(buildOnDiskName(analysis, { mode: 'muxed' })).toContain(
      '[Hindi-English DDP 5.1 + English TrueHD 7.1 Atmos]'
    )
  })
})

describe('release group: two tags keep only the last (encoder)', () => {
  it('drops the leading release tag from "DarQ HONE"', () => {
    expect(
      parseReleaseGroup('Movie.2024.2160p.UHD.BluRay.x265-DarQ HONE.mkv')
    ).toBe('HONE')
  })

  it('leaves a single-token group untouched', () => {
    expect(
      parseReleaseGroup('Inception.2018.1080p.BluRay.x264-RaZoR.mkv')
    ).toBe('RaZoR')
  })

  it('renders only the last tag in the muxed group block', () => {
    const draft = buildGeneratedNameDraft(
      makeAnalysis({
        path: '/m/Movie.2021.2160p.UHD.BluRay.x265-DarQ HONE.mkv',
        videoCodec: 'hevc',
        height: 2160,
        transfer: 'smpte2084',
        bitDepth: 10,
        audios: [
          { codec: 'eac3', channels: 6, lang: 'hin' },
          { codec: 'eac3', channels: 6, lang: 'eng' },
        ],
      })
    )
    expect(draft.generatedName).toContain('(HONE-Ionicboy)')
  })
})

describe('2160p / UHD / 4K recognition from the filename', () => {
  it('treats UHD, 4K and a bare 2160 as 2160p', () => {
    expect(
      parseFilenameTokens('Movie.2024.4K.BluRay.x265-G.mkv').resolution
    ).toBe('2160p')
    expect(
      parseFilenameTokens('Movie.2024.UHD.BluRay.x265-G.mkv').resolution
    ).toBe('2160p')
    expect(
      parseFilenameTokens('Movie.2024.2160.BluRay.x265-G.mkv').resolution
    ).toBe('2160p')
  })

  it('upgrades a 4K BluRay to UHD BluRay', () => {
    expect(parseFilenameTokens('Movie.2024.4K.BluRay.x265-G.mkv').source).toBe(
      'UHD BluRay'
    )
  })
})

describe('Remove year option', () => {
  it('drops the year from a muxed name', () => {
    expect(
      buildOnDiskName(makeAnalysis(CORPUS.inception_muxed), {
        mode: 'muxed',
        removeYear: true,
      })
    ).toBe(
      'Inception 1080p BluRay [Hindi-English DDP 5.1] x264 (RaZoR-Ionicboy)'
    )
  })

  it('drops the year from a VOD name', () => {
    expect(
      buildOnDiskName(makeAnalysis(CORPUS.inception_single), {
        removeYear: true,
      })
    ).toBe('Inception.1080p.BluRay.English.DDP.5.1.x264-RaZoR')
  })

  it('keeps the year when the option is off', () => {
    expect(
      buildGeneratedNameDraft(makeAnalysis(CORPUS.inception_muxed), {
        ...defaultPreferences,
        removeYear: false,
      }).generatedName
    ).toContain('(2018)')
  })
})

describe('mapping overrides', () => {
  it('audio codec override wins over the default mapping', () => {
    expect(mapAudioCodec('eac3', null, { eac3: 'DD+' })).toBe('DD+')
    expect(mapAudioCodec('opus', null, { opus: 'OPUS' })).toBe('OPUS')
  })

  it('video final override wins over the default mapping', () => {
    expect(mapVideoFinal('hevc', { hevc: 'H265' })).toBe('H265')
  })

  it('overrides flow through to the generated filename', () => {
    const out = buildOnDiskName(makeAnalysis(CORPUS.inception_single), {
      audioCodecOverrides: { eac3: 'DD+' },
      videoCodecOverrides: { h264: 'AVC' },
    })
    expect(out).toBe('Inception.2018.1080p.BluRay.English.DD+.5.1.AVC-RaZoR')
  })

  it('language override relabels a track', () => {
    const analysis = makeAnalysis({
      path: '/m/Movie.2018.1080p.BluRay.x264-Group.mkv',
      audios: [{ codec: 'eac3', channels: 6, lang: 'fil' }],
    })
    const tokens = previewTokens(analysis, {
      languageOverrides: { fil: 'Filipino' },
    })
    const audio = tokens.find(t => t.label === 'Audio')?.value ?? ''
    expect(audio).toContain('Filipino')
  })
})

describe('parseFilenameTokens (test-case runner)', () => {
  it('extracts filename-derivable tokens', () => {
    expect(
      parseFilenameTokens('Inception.2018.1080p.BluRay.DDP.5.1.x264-RaZoR.mkv')
    ).toEqual({
      title: 'Inception',
      year: '2018',
      seasonEpisode: '',
      resolution: '1080p',
      source: 'BluRay',
      group: 'RaZoR',
    })
  })

  it('handles a UHD series episode', () => {
    const t = parseFilenameTokens(
      'The.Show.2019.S01E05.2160p.UHD.BluRay.x265-Group.mkv'
    )
    expect(t.seasonEpisode).toBe('S01E05')
    expect(t.source).toBe('UHD BluRay')
  })
})

describe('previewTokens', () => {
  it('summarizes parsed media, dropping empty fields', () => {
    const tokens = previewTokens(makeAnalysis(CORPUS.inception_muxed))
    const byLabel = Object.fromEntries(tokens.map(t => [t.label, t.value]))
    expect(byLabel.Title).toBe('Inception')
    expect(byLabel.Codec).toBe('x264')
    expect(byLabel.Audio).toContain('Hindi DDP 5.1')
    expect(byLabel.HDR).toBeUndefined() // SDR dropped
  })
})

describe('subtitle classification', () => {
  const sub = (
    over: Partial<{
      title: string | null
      forced: boolean
      hearing_impaired: boolean
    }> = {}
  ) => ({
    stream_index: 4,
    codec: 'subrip',
    title: over.title ?? null,
    language: { code: 'eng', name: 'English' },
    flags: {
      forced: over.forced ?? false,
      default: false,
      hearing_impaired: over.hearing_impaired ?? false,
    },
  })

  it('SDH from disposition flag and from title', () => {
    expect(classifySubtitle(sub({ hearing_impaired: true }))).toBe('SDH')
    expect(classifySubtitle(sub({ title: 'English (SDH)' }))).toBe('SDH')
  })

  it('Forced from disposition flag and from title', () => {
    expect(classifySubtitle(sub({ forced: true }))).toBe('Forced')
    expect(classifySubtitle(sub({ title: 'English Forced' }))).toBe('Forced')
    expect(classifySubtitle(sub({ title: 'Signs & Songs' }))).toBe('Forced')
  })

  it('Dubtitle and Stripped from the title', () => {
    expect(classifySubtitle(sub({ title: 'English [Dubtitle]' }))).toBe(
      'Dubtitle'
    )
    expect(classifySubtitle(sub({ title: 'English (Stripped SDH)' }))).toBe(
      'Stripped'
    )
  })

  it('regular/full track has no classification', () => {
    expect(classifySubtitle(sub({ title: 'English' }))).toBe('')
    expect(classifySubtitle(sub())).toBe('')
  })
})

describe('validation warnings', () => {
  it('clean file has no warnings', () => {
    expect(
      collectNamingWarnings(makeAnalysis(CORPUS.inception_single))
    ).toEqual([])
  })

  it('flags untagged audio and missing group', () => {
    const warnings = collectNamingWarnings(makeAnalysis(CORPUS.untagged_audio))
    expect(warnings.some(w => /no language tag/.test(w))).toBe(true)
  })

  it('flags missing release group', () => {
    const warnings = collectNamingWarnings(makeAnalysis(CORPUS.no_group))
    expect(warnings.some(w => /release group/.test(w))).toBe(true)
  })
})

describe('muxed suffix from Filename tag', () => {
  it('uses the selected Filename tag as the suffix, overriding the default', () => {
    const draft = buildGeneratedNameDraft(
      makeAnalysis(CORPUS.inception_muxed),
      {
        ...defaultPreferences,
        filenameTag: 'blackHawk',
      }
    )
    expect(draft.generatedName).toContain('(RaZoR-blackHawk)')
  })

  it('falls back to the default suffix when no Filename tag is set', () => {
    const draft = buildGeneratedNameDraft(
      makeAnalysis(CORPUS.inception_muxed),
      {
        ...defaultPreferences,
        filenameTag: '',
        ionicSuffix: 'Ionicboy',
      }
    )
    expect(draft.generatedName).toContain('(RaZoR-Ionicboy)')
  })
})

describe('embedded container title (D1)', () => {
  it('movie -> "Title (Year)"', () => {
    const draft = buildGeneratedNameDraft(makeAnalysis(CORPUS.inception_single))
    expect(draft.videoTitleText).toBe('Inception (2018)')
  })

  it('series -> "Title (Year) SxxExx"', () => {
    const draft = buildGeneratedNameDraft(
      makeAnalysis({
        path: '/m/The.Show.2019.S01E05.1080p.BluRay.DDP.5.1.x264-Group.mkv',
        audios: [{ codec: 'eac3', channels: 6, lang: 'eng' }],
      })
    )
    expect(draft.videoTitleText).toBe('The Show (2019) S01E05')
  })

  it('SxxExx before the year is not doubled in the embedded title', () => {
    const draft = buildGeneratedNameDraft(
      makeAnalysis({
        path: '/m/Inception.S01E01.2018.1080p.BluRay.DDP.5.1.x264-RaZoR.mkv',
        audios: [{ codec: 'eac3', channels: 6, lang: 'eng' }],
      })
    )
    expect(draft.videoTitleText).toBe('Inception (2018) S01E01')
  })

  it('appends "- Downloaded From <tag>" when a track tag is selected', () => {
    const draft = buildGeneratedNameDraft(
      makeAnalysis({
        path: 'Rick.and.Morty.S01E01.Pilot.1080p.TrueHD.5.1.VC-1.REMUX-FraMeSToR.mkv',
        videoCodec: 'vc1',
        audios: [{ codec: 'truehd', channels: 6, lang: 'eng' }],
      }),
      { ...defaultPreferences, selectedTag: '4kHDHub.com' }
    )
    expect(draft.videoTitleText).toBe(
      'Rick and Morty S01E01 - Downloaded From 4kHDHub.com'
    )
  })

  it('legacy toggle restores the "Downloaded from" template', () => {
    const draft = buildGeneratedNameDraft(
      makeAnalysis(CORPUS.inception_single),
      {
        ...defaultPreferences,
        legacyContainerTitle: true,
      }
    )
    expect(draft.videoTitleText).toContain('Downloaded from')
  })
})

describe('track-title builders remain unchanged (regression lock)', () => {
  // These are the embedded track/container titles written by retag. They must NOT be
  // affected by the filename-engine change. Snapshotting locks the current behavior.
  it('inception_muxed metadata fields', () => {
    const draft = buildGeneratedNameDraft(makeAnalysis(CORPUS.inception_muxed))
    expect({
      videoTitleText: draft.videoTitleText,
      videoTitles: draft.videoTitles,
      audioTitles: draft.audioTitles,
    }).toMatchSnapshot()
  })
})

describe('retag audit regressions', () => {
  it('maps DTS profiles by whole word (DTS Express is not DTS-ES)', () => {
    // A bare substring test matched "es" inside "Express" and "ma" anywhere.
    expect(mapAudioCodec('dts', 'DTS Express')).toBe('DTS Express')
    expect(mapAudioCodec('dts', 'DTS-HD Master Audio')).toBe('DTS-HD MA')
    expect(mapAudioCodec('dts', 'DTS-ES')).toBe('DTS-ES')
    expect(mapAudioCodec('dts', 'DTS-X')).toBe('DTS:X')
    expect(mapAudioCodec('dts', 'DTS-HD HRA')).toBe('DTS-HD HRA')
  })

  it('renders unmapped channel counts as N.0, never a bare digit', () => {
    expect(normalizeChannels(5)).toBe('5.0')
    expect(normalizeChannels(9)).toBe('9.0')
    expect(normalizeChannels(6)).toBe('5.1')
  })

  it('track titles agree with the filename for DTS-HD MA / mlp / PCM', () => {
    // naming.ts used to carry a stunted codec map, so the embedded track title said
    // "DTS" while the filename said "DTS-HD MA".
    const analysis = makeAnalysis({
      path: '/m/Movie.2019.1080p.BluRay.REMUX.AVC.DTS-HD.MA.5.1-GRP.mkv',
      audios: [
        { codec: 'dts', channels: 6, lang: 'eng', profile: 'DTS-HD MA' },
      ],
    })
    // Pinned to auto: this asserts the VOD (dotted) rendering a single-audio file gets
    // under auto-detection, which the app default ('muxed') would otherwise bypass.
    const draft = buildGeneratedNameDraft(analysis, {
      ...defaultPreferences,
      namingMode: 'auto',
    })
    expect(draft.audioTitles[0]).toContain('DTS-HD MA')
    // Single-audio files render in VOD (dotted) mode, so spaces become dots.
    expect(draft.generatedName).toContain('DTS-HD.MA')
    expect(draft.audioTitles[0]).not.toMatch(/\bDTS\b(?!-HD)/)
  })

  it('excludes commentary tracks from the filename audio block', () => {
    const analysis = makeAnalysis({
      path: '/m/Movie.2019.1080p.BluRay.x264-GRP.mkv',
      audios: [
        { codec: 'truehd', channels: 8, lang: 'eng', atmos: true },
        { codec: 'ac3', channels: 2, lang: 'eng', commentary: true },
      ],
    })
    const name = buildOnDiskName(analysis)
    expect(name).toContain('TrueHD')
    // The AC3 2.0 commentary must not read as a second main English track.
    expect(name).not.toContain('DD 2.0')
  })

  it('keeps the audio block when every track is flagged commentary', () => {
    const audio = [
      {
        language: 'English',
        langCode: 'eng',
        codec: 'DDP',
        channels: '5.1',
        atmos: false,
        commentary: true,
      },
    ]
    expect(buildMuxedAudioBlock(audio)).toBe('English DDP 5.1')
  })

  it('picks the web provider that appears earliest in the filename', () => {
    // List order previously decided the winner, so ATVP shadowed ATV.
    const atv = buildOnDiskName(
      makeAnalysis({
        path: '/m/Show.2019.1080p.ATV.WEB-DL.DDP5.1.x264-GRP.mkv',
        audios: [{ codec: 'eac3', channels: 6, lang: 'eng' }],
      })
    )
    expect(atv).toContain('ATV')
    expect(atv).not.toContain('ATVP')
  })
})

describe('Dune Part Two (real-world multi-audio remux)', () => {
  // Hindi/Tamil/Telugu DDP5.1 + English TrueHD 7.1 main track + two commentary tracks.
  const analysis = makeAnalysis({
    path: '/m/Dune.part.two.2160p.UHD.Blu-Ray.TrueHD.7.1.Atmos.REMUX-Framestor.mkv',
    videoCodec: 'hevc',
    width: 3840,
    height: 2160,
    bitDepth: 10,
    audios: [
      { codec: 'eac3', channels: 6, lang: 'hin' },
      { codec: 'eac3', channels: 6, lang: 'tam' },
      { codec: 'eac3', channels: 6, lang: 'tel' },
      { codec: 'truehd', channels: 8, lang: 'eng', bitrate: 3406000 },
      { codec: 'ac3', channels: 2, lang: 'eng', commentary: true },
      { codec: 'ac3', channels: 2, lang: 'eng', commentary: true },
    ],
  })

  it('applies filename Atmos to the English TrueHD track, not the first DDP one', () => {
    // ffprobe often cannot see Atmos, and retagging overwrites the track title it would
    // be read from, so the filename is the backstop. It must pick the track the name
    // describes ("TrueHD.7.1.Atmos") rather than whichever track comes first.
    const parsed = toParsedMedia(analysis)
    const atmos = parsed.audio.filter(a => a.atmos)
    expect(atmos).toHaveLength(1)
    expect(atmos[0]?.codec).toBe('TrueHD')
    expect(atmos[0]?.language).toBe('English')
  })

  it('keeps REMUX on HEVC and drops both commentary tracks', () => {
    const name = buildOnDiskName(analysis)
    expect(name).toContain('UHD BluRay')
    expect(name).toContain('REMUX')
    expect(name).toContain('HEVC')
    expect(name).not.toContain('x265')
    expect(name).toContain('TrueHD 7.1 Atmos')
    expect(name).toContain('Hindi-Tamil-Telugu DDP 5.1')
    expect(name).not.toContain('DD 2.0')
  })
})

describe('inside (embedded) track titles', () => {
  it('keeps each commentary track distinguishable', () => {
    // Three commentary tracks with the same codec/channels previously collapsed to three
    // identical strings, destroying which commentary was which.
    const analysis = makeAnalysis({
      path: '/m/Dune.part.two.2160p.UHD.Blu-Ray.TrueHD.7.1.Atmos.REMUX-Framestor.mkv',
      audios: [
        { codec: 'truehd', channels: 8, lang: 'eng' },
        {
          codec: 'ac3',
          channels: 2,
          lang: 'eng',
          commentary: true,
          title: 'Commentary by Denis Villeneuve',
        },
        {
          codec: 'ac3',
          channels: 2,
          lang: 'eng',
          commentary: true,
          title: 'Feature Commentary with Cast',
        },
      ],
    })
    const draft = buildGeneratedNameDraft(analysis)
    expect(draft.audioTitles[1]).toContain('Commentary by Denis Villeneuve')
    expect(draft.audioTitles[2]).toContain('Feature Commentary with Cast')
    expect(draft.audioTitles[1]).not.toBe(draft.audioTitles[2])
    // The technical details are still appended.
    expect(draft.audioTitles[1]).toContain('DD 2.0')
  })

  it('does not prefix a normal track with its existing title', () => {
    const analysis = makeAnalysis({
      path: '/m/Movie.2020.1080p.BluRay.x264-G.mkv',
      audios: [
        { codec: 'eac3', channels: 6, lang: 'eng', title: 'Some Old Label' },
      ],
    })
    const draft = buildGeneratedNameDraft(analysis)
    expect(draft.audioTitles[0]).not.toContain('Some Old Label')
  })
})

describe('SDR token', () => {
  // Real case: War.Dogs.2016.2160p.BluRay.x265.10bit.SDR.DTS-HD.MA.5.1-SWTYBLZ
  const warDogs = {
    path: '/m/War.Dogs.2016.2160p.BluRay.x265.10bit.SDR.DTS-HD.MA.5.1-SWTYBLZ.mkv',
    videoCodec: 'hevc',
    height: 2160,
    transfer: 'bt709',
    bitDepth: 10,
    audios: [{ codec: 'dts', channels: 6, lang: 'eng', profile: 'DTS-HD MA' }],
  }

  it('emits SDR before the bit-depth descriptor at 2160p', () => {
    const name = buildOnDiskName(makeAnalysis(warDogs), { mode: 'vod' })
    expect(name).toContain('SDR')
    expect(name).toMatch(/SDR\.10bit\.HEVC/)
  })

  it('emits SDR in muxed mode too', () => {
    const name = buildOnDiskName(makeAnalysis(warDogs), { mode: 'muxed' })
    expect(name).toMatch(/SDR 10bit HEVC/)
  })

  it('never emits SDR at 1080p', () => {
    const name = buildOnDiskName(
      makeAnalysis({
        path: '/m/Movie.2020.1080p.BluRay.SDR.x264-G.mkv',
        videoCodec: 'h264',
        height: 1080,
        transfer: 'bt709',
        audios: [{ codec: 'eac3', channels: 6, lang: 'eng' }],
      })
    )
    expect(name).not.toContain('SDR')
  })

  it('never emits SDR alongside HDR', () => {
    const name = buildOnDiskName(makeAnalysis(CORPUS.blade_runner_2049), {
      mode: 'muxed',
    })
    expect(name).toContain('HDR')
    expect(name).not.toContain('SDR')
  })

  it('reports SDR in the parsed-token preview', () => {
    const tokens = previewTokens(makeAnalysis(warDogs))
    expect(tokens.find(t => t.label === 'HDR')?.value).toBe('SDR')
  })
})

describe('NO_TAG (tagging turned off)', () => {
  const analysis = () =>
    makeAnalysis({
      path: '/m/Movie.2020.1080p.BluRay.x264-Group.mkv',
      videoCodec: 'h264',
      height: 1080,
      transfer: 'bt709',
      audios: [{ codec: 'eac3', channels: 6, lang: 'hin', atmos: true }],
    })

  it('drops the tag from track titles, leaving no trailing separator', () => {
    const draft = buildGeneratedNameDraft(analysis(), {
      ...defaultPreferences,
      tags: ['4kHDHub.com'],
      selectedTag: NO_TAG,
    })
    expect(draft.audioTitles[0]).toBe('Hindi / DDP 5.1 Atmos / 48 kHz')
    expect(draft.audioTitles[0]).not.toContain('4kHDHub.com')
    expect(draft.audioTitles[0]?.trim().endsWith('/')).toBe(false)
  })

  it('drops the "Downloaded From" suffix from the container title', () => {
    const draft = buildGeneratedNameDraft(analysis(), {
      ...defaultPreferences,
      tags: ['4kHDHub.com'],
      selectedTag: NO_TAG,
    })
    expect(draft.videoTitleText).toBe('Movie (2020)')
    expect(draft.videoTitleText).not.toContain('Downloaded From')
  })

  it('drops the group suffix from the filename', () => {
    const draft = buildGeneratedNameDraft(analysis(), {
      ...defaultPreferences,
      tags: ['4kHDHub.com'],
      filenameTag: NO_TAG,
      namingMode: 'muxed',
    })
    expect(draft.generatedName).toContain('(Group)')
    expect(draft.generatedName).not.toContain('Ionicboy')
    expect(draft.generatedName).not.toContain('4kHDHub.com')
  })

  it('still falls back to the first tag when the selection is merely blank', () => {
    // '' means "unset" (fresh install), which must keep the existing fallback.
    const draft = buildGeneratedNameDraft(analysis(), {
      ...defaultPreferences,
      tags: ['4kHDHub.com'],
      selectedTag: '',
    })
    expect(draft.audioTitles[0]).toContain('4kHDHub.com')
  })
})

describe('default naming mode', () => {
  it('defaults to muxed, so a single-audio file is not dotted', () => {
    expect(defaultPreferences.namingMode).toBe('muxed')
    const draft = buildGeneratedNameDraft(makeAnalysis(CORPUS.up))
    // Muxed renders with spaces; the auto default would have dotted this single-audio file.
    expect(draft.generatedName).toContain(' ')
    expect(draft.generatedName).toMatch(/\(\d{4}\)/)
  })
})

describe('Atmos in track titles', () => {
  it('places Atmos after the channel layout, matching the filename', () => {
    const analysis = makeAnalysis({
      path: '/m/Movie.2020.2160p.BluRay.TrueHD.7.1.Atmos.x265-G.mkv',
      videoCodec: 'hevc',
      height: 2160,
      transfer: 'smpte2084',
      bitDepth: 10,
      audios: [{ codec: 'truehd', channels: 8, lang: 'eng', atmos: true }],
    })
    const draft = buildGeneratedNameDraft(analysis, defaultPreferences)
    expect(draft.audioTitles[0]).toContain('TrueHD 7.1 Atmos')
    expect(draft.audioTitles[0]).not.toContain('TrueHD Atmos')
    // The name on disk states it the same way.
    expect(draft.generatedName).toContain('TrueHD 7.1 Atmos')
  })

  it('applies the filename Atmos fallback when ffprobe missed it', () => {
    // ffprobe frequently cannot see Atmos, so the flag is false while the name says it.
    const analysis = makeAnalysis({
      path: '/m/Movie.2020.1080p.BluRay.TrueHD.7.1.Atmos.x264-G.mkv',
      videoCodec: 'h264',
      height: 1080,
      transfer: 'bt709',
      audios: [{ codec: 'truehd', channels: 8, lang: 'eng', atmos: false }],
    })
    const draft = buildGeneratedNameDraft(analysis, defaultPreferences)
    expect(draft.audioTitles[0]).toContain('TrueHD 7.1 Atmos')
    expect(draft.generatedName).toContain('TrueHD 7.1 Atmos')
  })

  it('never gives a commentary track the filename Atmos', () => {
    const analysis = makeAnalysis({
      path: '/m/Movie.2020.1080p.BluRay.TrueHD.7.1.Atmos.x264-G.mkv',
      videoCodec: 'h264',
      height: 1080,
      transfer: 'bt709',
      audios: [
        { codec: 'truehd', channels: 8, lang: 'eng', atmos: false },
        {
          codec: 'ac3',
          channels: 2,
          lang: 'eng',
          commentary: true,
          title: 'Director commentary',
        },
      ],
    })
    const draft = buildGeneratedNameDraft(analysis, defaultPreferences)
    expect(draft.audioTitles[0]).toContain('TrueHD 7.1 Atmos')
    expect(draft.audioTitles[1]).not.toContain('Atmos')
  })

  it('leaves a non-Atmos track untouched', () => {
    const analysis = makeAnalysis({
      path: '/m/Movie.2020.1080p.BluRay.DDP.5.1.x264-G.mkv',
      videoCodec: 'h264',
      height: 1080,
      transfer: 'bt709',
      audios: [{ codec: 'eac3', channels: 6, lang: 'eng' }],
    })
    const draft = buildGeneratedNameDraft(analysis, defaultPreferences)
    expect(draft.audioTitles[0]).toContain('DDP 5.1')
    expect(draft.audioTitles[0]).not.toContain('Atmos')
  })
})
