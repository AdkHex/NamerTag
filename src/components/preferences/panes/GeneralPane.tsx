import { useMemo } from 'react'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePreferences, useSavePreferences } from '@/services/preferences'
import { defaultPreferences } from '@/types/preferences'
import { TagManager } from '@/components/sidebar/TagManager'

interface SettingsFieldProps {
  label: string
  children: React.ReactNode
  description?: React.ReactNode
}

const SettingsField = ({
  label,
  children,
  description,
}: SettingsFieldProps) => (
  <div className="space-y-2">
    <Label className="text-sm font-medium text-foreground">{label}</Label>
    {children}
    {description ? (
      <div className="text-sm text-muted-foreground">{description}</div>
    ) : null}
  </div>
)

interface VariableInfo {
  name: string
  description: string
  example: string
}

const VariableList = ({ variables }: { variables: VariableInfo[] }) => (
  <div className="flex flex-wrap gap-2">
    {variables.map(variable => (
      <span key={variable.name}>{variable.name}</span>
    ))}
  </div>
)

interface SettingsSectionProps {
  title: string
  children: React.ReactNode
}

const SettingsSection = ({ title, children }: SettingsSectionProps) => (
  <div className="space-y-4">
    <div>
      <h3 className="text-lg font-medium text-foreground">{title}</h3>
      <Separator className="mt-2" />
    </div>
    <div className="space-y-4">{children}</div>
  </div>
)

export const GeneralPane = () => {
  const { data: preferences } = usePreferences()
  const savePreferences = useSavePreferences()

  const templates = useMemo(
    () => ({
      videoTrackTemplate:
        preferences?.videoTrackTemplate ??
        defaultPreferences.videoTrackTemplate,
      audioTrackTemplate:
        preferences?.audioTrackTemplate ??
        defaultPreferences.audioTrackTemplate,
      subtitleTrackTemplate:
        preferences?.subtitleTrackTemplate ??
        defaultPreferences.subtitleTrackTemplate,
      videoTitleTemplate:
        preferences?.videoTitleTemplate ??
        defaultPreferences.videoTitleTemplate,
      blurayFilenameTemplate:
        preferences?.blurayFilenameTemplate ??
        defaultPreferences.blurayFilenameTemplate,
      webFilenameTemplate:
        preferences?.webFilenameTemplate ??
        defaultPreferences.webFilenameTemplate,
    }),
    [preferences]
  )

  if (!preferences) {
    return <div className="text-sm text-muted-foreground">Loading…</div>
  }

  return (
    <div className="space-y-6">
      <SettingsSection title="Tags">
        <TagManager />
      </SettingsSection>
      <SettingsSection title="Naming Templates">
        <SettingsField
          label="Video track template"
          description={
            <VariableList
              variables={[
                {
                  name: '{resolution}',
                  description: 'Video resolution tag.',
                  example: '2160p',
                },
                {
                  name: '{source}',
                  description: 'Detected source type.',
                  example: 'UHD BluRay',
                },
                {
                  name: '{hdr}',
                  description: 'HDR label when available.',
                  example: 'DoVi HDR',
                },
                {
                  name: '{remux}',
                  description: 'REMUX label if applicable.',
                  example: 'REMUX',
                },
                {
                  name: '{videoBitDepth}',
                  description: 'Bit depth label when >= 10.',
                  example: '10bit',
                },
                {
                  name: '{videoCodec}',
                  description: 'Video codec label.',
                  example: 'HEVC',
                },
                {
                  name: '{trackTag}',
                  description: 'Selected track tag.',
                  example: '4kHDHub.com',
                },
              ]}
            />
          }
        >
          <Input
            key={templates.videoTrackTemplate}
            defaultValue={templates.videoTrackTemplate}
            onBlur={event =>
              savePreferences.mutateAsync({
                videoTrackTemplate:
                  event.currentTarget.value.trim() ||
                  defaultPreferences.videoTrackTemplate,
              })
            }
            disabled={savePreferences.isPending}
          />
        </SettingsField>

        <SettingsField
          label="Audio track template"
          description={
            <VariableList
              variables={[
                {
                  name: '{language}',
                  description: 'Track language.',
                  example: 'English',
                },
                {
                  name: '{audioCodec}',
                  description: 'Audio codec label.',
                  example: 'DDP',
                },
                {
                  name: '{audioChannels}',
                  description: 'Channel layout.',
                  example: '5.1',
                },
                {
                  name: '{bitrate}',
                  description: 'Audio bitrate.',
                  example: '640Kbps',
                },
                {
                  name: '{sampleRate}',
                  description: 'Sample rate.',
                  example: '48 kHz',
                },
                {
                  name: '{audioBitDepth}',
                  description: 'Audio bit depth when detected.',
                  example: '24-bit',
                },
                {
                  name: '{trackTag}',
                  description: 'Selected track tag.',
                  example: '4kHDHub.com',
                },
              ]}
            />
          }
        >
          <Input
            key={templates.audioTrackTemplate}
            defaultValue={templates.audioTrackTemplate}
            onBlur={event =>
              savePreferences.mutateAsync({
                audioTrackTemplate:
                  event.currentTarget.value.trim() ||
                  defaultPreferences.audioTrackTemplate,
              })
            }
            disabled={savePreferences.isPending}
          />
        </SettingsField>

        <SettingsField
          label="Subtitle track template"
          description={
            <VariableList
              variables={[
                {
                  name: '{language}',
                  description: 'Subtitle language.',
                  example: 'English',
                },
                {
                  name: '{subtitleFlags}',
                  description: 'Flags like Forced/SDH.',
                  example: 'Forced',
                },
                {
                  name: '{trackTag}',
                  description: 'Selected track tag.',
                  example: '4kHDHub.com',
                },
              ]}
            />
          }
        >
          <Input
            key={templates.subtitleTrackTemplate}
            defaultValue={templates.subtitleTrackTemplate}
            onBlur={event =>
              savePreferences.mutateAsync({
                subtitleTrackTemplate:
                  event.currentTarget.value.trim() ||
                  defaultPreferences.subtitleTrackTemplate,
              })
            }
            disabled={savePreferences.isPending}
          />
        </SettingsField>

        <SettingsField
          label="Video title template"
          description={
            <VariableList
              variables={[
                {
                  name: '{title}',
                  description: 'Parsed title.',
                  example: 'Interstellar',
                },
                {
                  name: '{year}',
                  description: 'Release year.',
                  example: '2017',
                },
                {
                  name: '{seasonEpisode}',
                  description: 'Season/episode for series.',
                  example: 'S01E01',
                },
                {
                  name: '{filenameTag}',
                  description: 'Selected filename tag.',
                  example: '4kHDHub.com',
                },
              ]}
            />
          }
        >
          <Input
            key={templates.videoTitleTemplate}
            defaultValue={templates.videoTitleTemplate}
            onBlur={event =>
              savePreferences.mutateAsync({
                videoTitleTemplate:
                  event.currentTarget.value.trim() ||
                  defaultPreferences.videoTitleTemplate,
              })
            }
            disabled={savePreferences.isPending}
          />
        </SettingsField>

        <SettingsField
          label="BluRay filename template"
          description={
            <VariableList
              variables={[
                {
                  name: '{title}',
                  description: 'Parsed title.',
                  example: 'Southpaw',
                },
                {
                  name: '{year}',
                  description: 'Release year.',
                  example: '2015',
                },
                {
                  name: '{seasonEpisode}',
                  description: 'Season/episode for series.',
                  example: 'S01E01',
                },
                {
                  name: '{resolution}',
                  description: 'Resolution tag.',
                  example: '1080p',
                },
                {
                  name: '{source}',
                  description: 'Source label.',
                  example: 'BluRay',
                },
                {
                  name: '{remux}',
                  description: 'REMUX label if applicable.',
                  example: 'REMUX',
                },
                {
                  name: '{bitDepth}',
                  description: 'Bit depth label.',
                  example: '10bit',
                },
                { name: '{hdr}', description: 'HDR label.', example: 'HDR' },
                {
                  name: '{videoCodec}',
                  description: 'Video codec label.',
                  example: 'HEVC',
                },
                {
                  name: '{audioList}',
                  description: 'Joined audio track list.',
                  example: 'English TrueHD 7.1 Atmos + English DD 5.1',
                },
                {
                  name: '{codecSuffix}',
                  description: 'Suffix for x264/x265 cases.',
                  example: 'x264',
                },
                {
                  name: '{encoderName}',
                  description: 'Encoder name override or parsed.',
                  example: 'CiNEPHiLES',
                },
                {
                  name: '{filenameTag}',
                  description: 'Selected filename tag.',
                  example: '4kHDHub.com',
                },
                {
                  name: '{provider}',
                  description: 'WEB provider if detected.',
                  example: 'NF',
                },
                {
                  name: '{webType}',
                  description: 'WEB type if detected.',
                  example: 'WEB-DL',
                },
                {
                  name: '{extension}',
                  description: 'File extension.',
                  example: 'mkv',
                },
              ]}
            />
          }
        >
          <Input
            key={templates.blurayFilenameTemplate}
            defaultValue={templates.blurayFilenameTemplate}
            onBlur={event =>
              savePreferences.mutateAsync({
                blurayFilenameTemplate:
                  event.currentTarget.value.trim() ||
                  defaultPreferences.blurayFilenameTemplate,
              })
            }
            disabled={savePreferences.isPending}
          />
        </SettingsField>

        <SettingsField
          label="WEB-DL/WEBRip filename template"
          description={
            <VariableList
              variables={[
                {
                  name: '{title}',
                  description: 'Parsed title.',
                  example: 'Southpaw',
                },
                {
                  name: '{year}',
                  description: 'Release year.',
                  example: '2015',
                },
                {
                  name: '{seasonEpisode}',
                  description: 'Season/episode for series.',
                  example: 'S01E01',
                },
                {
                  name: '{resolution}',
                  description: 'Resolution tag.',
                  example: '2160p',
                },
                {
                  name: '{source}',
                  description: 'Source label.',
                  example: 'WEB-DL',
                },
                {
                  name: '{provider}',
                  description: 'WEB provider.',
                  example: 'AMZN',
                },
                {
                  name: '{webType}',
                  description: 'WEB type.',
                  example: 'WEBRip',
                },
                {
                  name: '{remux}',
                  description: 'REMUX label if applicable.',
                  example: 'REMUX',
                },
                {
                  name: '{bitDepth}',
                  description: 'Bit depth label.',
                  example: '10bit',
                },
                {
                  name: '{hdr}',
                  description: 'HDR label.',
                  example: 'DoVi HDR',
                },
                {
                  name: '{videoCodec}',
                  description: 'Video codec label.',
                  example: 'H.265',
                },
                {
                  name: '{audioList}',
                  description: 'Joined audio track list.',
                  example: 'English DDP 5.1 + Hindi DDP 5.1',
                },
                {
                  name: '{codecSuffix}',
                  description: 'Suffix for x264/x265 cases.',
                  example: 'x265',
                },
                {
                  name: '{encoderName}',
                  description: 'Encoder name override or parsed.',
                  example: 'FLUX',
                },
                {
                  name: '{filenameTag}',
                  description: 'Selected filename tag.',
                  example: '4kHDHub.com',
                },
                {
                  name: '{extension}',
                  description: 'File extension.',
                  example: 'mkv',
                },
              ]}
            />
          }
        >
          <Input
            key={templates.webFilenameTemplate}
            defaultValue={templates.webFilenameTemplate}
            onBlur={event =>
              savePreferences.mutateAsync({
                webFilenameTemplate:
                  event.currentTarget.value.trim() ||
                  defaultPreferences.webFilenameTemplate,
              })
            }
            disabled={savePreferences.isPending}
          />
        </SettingsField>
      </SettingsSection>
    </div>
  )
}

export default GeneralPane
