// Types that match the Rust AppPreferences struct
// Only contains settings that should be persisted to disk

/**
 * Sentinel for "deliberately no tag", stored in `selectedTag` / `filenameTag`.
 *
 * An empty string cannot express this: the builders fall back to `tags[0]` when the
 * selection is blank (so a fresh install still tags something), which makes "" mean
 * "unset" rather than "none". This sentinel is a real, persisted choice that suppresses
 * the tag everywhere — track titles, the container title, and the filename suffix.
 */
export const NO_TAG = '__no_tag__'

/** Resolve a stored tag preference to the text to emit ('' when tagging is off). */
export function resolveTag(
  selection: string | undefined,
  fallback: string | undefined = ''
): string {
  if (selection === NO_TAG) return ''
  return selection?.trim() || fallback.trim()
}

export interface AppPreferences {
  theme: string
  autoCheckUpdates: boolean
  tags: string[]
  selectedTag: string
  filenameTag: string
  videoTrackTemplate: string
  audioTrackTemplate: string
  subtitleTrackTemplate: string
  videoTitleTemplate: string
  blurayFilenameTemplate: string
  webFilenameTemplate: string
  encoderName: string
  printTypeOverride: 'BluRay' | 'WEB-DL' | ''
  namingMode: 'auto' | 'muxed' | 'vod'
  ionicSuffix: string
  removeYear: boolean
  languagePriority: string[]
  legacyContainerTitle: boolean
  videoCodecOverrides: Record<string, string>
  audioCodecOverrides: Record<string, string>
  languageOverrides: Record<string, string>
  /** Legacy five-key values. Kept so older saved preferences still load; new writes go to
   *  `metadataValues`, which is keyed by field id and supports custom fields. */
  generalMetadata: GeneralMetadata
  /** Field definitions for Extra Actions: labels, visibility and tag destinations. */
  metadataFields: MetadataField[]
  /** Field id -> entered value. */
  metadataValues: Record<string, string>
}

// "Extra Actions" general-metadata values, permanently written into each file's MediaInfo
// general section. Editable and persisted so release branding is remembered between sessions.
export interface GeneralMetadata {
  writingApplication: string
  muxingApplication: string
  website: string
  encodedBy: string
  telegram: string
}

export const defaultGeneralMetadata: GeneralMetadata = {
  writingApplication: '',
  muxingApplication: '',
  website: '',
  encodedBy: '',
  telegram: '',
}

/**
 * Where a metadata field is written inside the container.
 *
 * `writing-application` / `muxing-application` are MKV segment-info properties with a
 * dedicated mkvpropedit flag. Everything else becomes a global tag (`WEBSITE`,
 * `ENCODED_BY`, ...), which is also how user-defined fields are stored.
 */
export type MetadataTarget =
  | 'writing-application'
  | 'muxing-application'
  | 'tag'

export interface MetadataField {
  /** Stable identity. Never shown; renaming the label must not orphan the saved value. */
  id: string
  /** Editable display text shown above the input. */
  label: string
  /** Container destination. Fixed for built-ins; always 'tag' for custom fields. */
  target: MetadataTarget
  /** Global-tag name when target is 'tag' (e.g. WEBSITE). Ignored otherwise. */
  tagName: string
  /** Hidden fields are not rendered in Extra Actions and are never written. */
  enabled: boolean
  /** Greyed hint text inside the input. */
  placeholder: string
  /** Built-ins cannot be deleted, only renamed or hidden. */
  builtIn: boolean
}

/**
 * The five original fields, now expressed as data. `id` values match the legacy
 * `GeneralMetadata` keys so previously saved values migrate without a lookup table.
 */
export const defaultMetadataFields: MetadataField[] = [
  {
    id: 'writingApplication',
    label: 'Writing application',
    target: 'writing-application',
    tagName: '',
    enabled: true,
    placeholder: 'e.g. mkvmerge',
    builtIn: true,
  },
  {
    id: 'muxingApplication',
    label: 'Writing library',
    target: 'muxing-application',
    tagName: '',
    enabled: true,
    placeholder: 'e.g. Ionicboy',
    builtIn: true,
  },
  {
    id: 'website',
    label: 'Website',
    target: 'tag',
    tagName: 'WEBSITE',
    enabled: true,
    placeholder: 'e.g. example.com',
    builtIn: true,
  },
  {
    id: 'encodedBy',
    label: 'Encoded by',
    target: 'tag',
    tagName: 'ENCODED_BY',
    enabled: true,
    placeholder: 'e.g. Ionicboy',
    builtIn: true,
  },
  {
    id: 'telegram',
    label: 'Telegram',
    target: 'tag',
    tagName: 'TELEGRAM',
    enabled: true,
    placeholder: 'e.g. @ionicboy',
    builtIn: true,
  },
]

/** Normalize free text into a valid Matroska global-tag name (A-Z, 0-9, underscore). */
export function toTagName(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export const defaultPreferences: AppPreferences = {
  theme: 'dark',
  autoCheckUpdates: true,
  tags: [],
  selectedTag: '',
  filenameTag: '',
  videoTrackTemplate:
    '{resolution} / {source} / {hdr} / {remux} / {videoBitDepth} / {videoCodec} / {trackTag}',
  audioTrackTemplate:
    '{language} / {audioCodec} {audioChannels} / {bitrate} / {sampleRate} / {audioBitDepth} / {trackTag}',
  subtitleTrackTemplate: '{language} / {subtitleFlags} / {trackTag}',
  videoTitleTemplate:
    '{title} ({year}) {seasonEpisode} - Downloaded from {filenameTag}',
  blurayFilenameTemplate:
    '{title} ({year}) {seasonEpisode} {resolution} {source} {remux} {bitDepth} {hdr} {videoCodec} [{audioList}] {codecSuffix} ({encoderName} - {filenameTag})',
  webFilenameTemplate:
    '{title} ({year}) {seasonEpisode} {resolution} {provider} {webType} {bitDepth} {hdr} {videoCodec} [{audioList}] {codecSuffix} ({encoderName} - {filenameTag})',
  encoderName: '',
  printTypeOverride: '',
  namingMode: 'muxed',
  ionicSuffix: 'Ionicboy',
  removeYear: false,
  languagePriority: ['hin', 'eng'],
  legacyContainerTitle: false,
  videoCodecOverrides: {},
  audioCodecOverrides: {},
  languageOverrides: {},
  generalMetadata: defaultGeneralMetadata,
  metadataFields: defaultMetadataFields,
  metadataValues: {},
}

/**
 * Resolve the field list to render, tolerating preferences saved before this feature
 * existed. Built-ins missing from a stored list are appended so a new built-in field
 * cannot vanish for existing users.
 */
export function resolveMetadataFields(
  stored?: MetadataField[] | null
): MetadataField[] {
  if (!stored || stored.length === 0) return defaultMetadataFields
  const seen = new Set(stored.map(field => field.id))
  const missing = defaultMetadataFields.filter(field => !seen.has(field.id))
  return [...stored, ...missing]
}

/**
 * Field values, migrating the legacy `generalMetadata` object on first read. The legacy
 * keys are the built-in ids, so a direct merge is enough; explicit `metadataValues`
 * always win.
 */
export function resolveMetadataValues(
  values?: Record<string, string> | null,
  legacy?: GeneralMetadata | null
): Record<string, string> {
  return { ...(legacy ?? {}), ...(values ?? {}) }
}
