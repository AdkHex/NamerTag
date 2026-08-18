// Types that match the Rust AppPreferences struct
// Only contains settings that should be persisted to disk
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
  generalMetadata: GeneralMetadata
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
  namingMode: 'auto',
  ionicSuffix: 'Ionicboy',
  removeYear: false,
  languagePriority: ['hin', 'eng'],
  legacyContainerTitle: false,
  videoCodecOverrides: {},
  audioCodecOverrides: {},
  languageOverrides: {},
  generalMetadata: defaultGeneralMetadata,
}
