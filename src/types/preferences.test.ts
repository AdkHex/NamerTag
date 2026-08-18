import { describe, expect, it } from 'vitest'
import {
  defaultMetadataFields,
  resolveMetadataFields,
  resolveMetadataValues,
  toTagName,
} from './preferences'

describe('metadata fields', () => {
  it('normalizes labels into Matroska tag names', () => {
    expect(toTagName('Release Group')).toBe('RELEASE_GROUP')
    expect(toTagName('  source!  ')).toBe('SOURCE')
    expect(toTagName('4kHDHub.com')).toBe('4KHDHUB_COM')
    expect(toTagName('---')).toBe('')
  })

  it('falls back to built-ins when nothing is stored', () => {
    expect(resolveMetadataFields(null)).toEqual(defaultMetadataFields)
    expect(resolveMetadataFields([])).toEqual(defaultMetadataFields)
  })

  it('appends built-ins missing from a stored list', () => {
    // A user who saved before a new built-in existed must still receive it.
    const first = defaultMetadataFields[0]
    if (!first) throw new Error('expected a built-in field')
    const resolved = resolveMetadataFields([first])
    expect(resolved).toHaveLength(defaultMetadataFields.length)
    expect(resolved[0]).toEqual(first)
  })

  it('keeps a renamed stored field rather than resetting it', () => {
    const first = defaultMetadataFields[0]
    if (!first) throw new Error('expected a built-in field')
    const resolved = resolveMetadataFields([{ ...first, label: 'Muxer' }])
    expect(resolved[0]?.label).toBe('Muxer')
  })

  it('migrates legacy generalMetadata values by id', () => {
    const values = resolveMetadataValues(undefined, {
      writingApplication: 'mkvmerge',
      muxingApplication: '',
      website: 'example.com',
      encodedBy: '',
      telegram: '',
    })
    expect(values.writingApplication).toBe('mkvmerge')
    expect(values.website).toBe('example.com')
  })

  it('prefers explicit values over the legacy object', () => {
    const values = resolveMetadataValues(
      { website: 'new.com' },
      {
        writingApplication: '',
        muxingApplication: '',
        website: 'old.com',
        encodedBy: '',
        telegram: '',
      }
    )
    expect(values.website).toBe('new.com')
  })
})
