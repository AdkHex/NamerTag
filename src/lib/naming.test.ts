import { describe, expect, it } from 'vitest'
import {
  buildGeneratedNameDraft,
  buildRenameTargetPath,
  sanitizeFilenameBase,
  stripExtensionFromName,
} from './naming'
import { makeAnalysis } from './__fixtures__/media-analysis'

describe('naming safety helpers', () => {
  it('treats path separators in generated names as filename text', () => {
    expect(buildRenameTargetPath('/media/source/Movie.mkv', 'AC/DC Live')).toBe(
      '/media/source/AC DC Live.mkv'
    )
  })

  it('strips known media extensions before appending the original extension', () => {
    expect(stripExtensionFromName('Movie Title.mp4', 'mkv')).toBe('Movie Title')
  })

  it('avoids reserved Windows filenames', () => {
    expect(sanitizeFilenameBase('CON')).toBe('CON_')
  })
})

describe('audio bit depth token', () => {
  it('renders the bit depth for lossless tracks (FLAC/PCM)', () => {
    const flac = buildGeneratedNameDraft(
      makeAnalysis({
        path: '/m/Movie.2020.1080p.BluRay.x264.mkv',
        audios: [{ codec: 'flac', channels: 2, lang: 'eng', bitDepth: 24 }],
      })
    )
    expect(flac.audioTitles[0]).toContain('24bit')

    const pcm = buildGeneratedNameDraft(
      makeAnalysis({
        path: '/m/Movie.2020.1080p.BluRay.x264.mkv',
        audios: [
          { codec: 'pcm_s24le', channels: 2, lang: 'eng', bitDepth: 24 },
        ],
      })
    )
    expect(pcm.audioTitles[0]).toContain('24bit')
  })

  it('stays empty for lossy tracks even when ffprobe reports a depth', () => {
    const aac = buildGeneratedNameDraft(
      makeAnalysis({
        path: '/m/Movie.2020.1080p.WEB-DL.x264.mkv',
        audios: [{ codec: 'aac', channels: 2, lang: 'eng', bitDepth: 24 }],
      })
    )
    expect(aac.audioTitles[0]).not.toMatch(/\d+bit/)
  })
})
