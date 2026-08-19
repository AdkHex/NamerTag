import { describe, expect, it } from 'vitest'
import { buildGeneratedNameDraft } from './naming'
import { CORPUS, makeAnalysis } from './__fixtures__/media-analysis'
import { defaultPreferences } from '@/types/preferences'

// The corpus exercises auto-detection (VOD for single-audio, muxed otherwise), so it pins
// the mode explicitly rather than inheriting whatever the app default happens to be —
// otherwise changing that default silently drops the auto path from coverage.
const AUTO = { ...defaultPreferences, namingMode: 'auto' as const }

/**
 * Living corpus contract for filename generation.
 *
 * Wave 0/1 baseline: snapshots capture output AFTER the Wave 1 fixes (no SDR, no empty
 * "[]"/"( - )" artifacts) but BEFORE the Wave 2 naming-engine. They still show the known
 * gaps the engine will fix (HEVC not yet x265, no "-Ionicboy", group grabs tech tokens,
 * dropped untagged/PCM audio). Wave 2 will update these snapshots to the target outputs.
 */
describe('naming corpus — generated filenames', () => {
  for (const [name, opt] of Object.entries(CORPUS)) {
    it(`generates a name for: ${name}`, () => {
      const draft = buildGeneratedNameDraft(makeAnalysis(opt), AUTO)
      expect(draft.generatedName).toMatchSnapshot()
    })
  }
})

describe('Wave 1 invariants (must hold for every corpus case)', () => {
  for (const [name, opt] of Object.entries(CORPUS)) {
    const draft = buildGeneratedNameDraft(makeAnalysis(opt), AUTO)
    const generated = draft.generatedName

    it(`${name}: never contains the literal "SDR"`, () => {
      expect(generated).not.toMatch(/\bSDR\b/)
    })

    it(`${name}: never contains an empty audio block "[]"`, () => {
      expect(generated).not.toContain('[]')
    })

    it(`${name}: never contains a dangling "( - )" / "( -" / "- )" artifact`, () => {
      expect(generated).not.toMatch(/\(\s*-\s*\)/)
      expect(generated).not.toMatch(/\(\s*-\s/)
      expect(generated).not.toMatch(/\s-\s*\)/)
    })
  }
})
