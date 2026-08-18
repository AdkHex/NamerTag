import React, { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { usePreferences, useSavePreferences } from '@/services/preferences'
import { parseFilenameTokens } from '@/lib/naming-engine'

const SettingsSection: React.FC<{
  title: string
  children: React.ReactNode
}> = ({ title, children }) => (
  <div className="space-y-4">
    <div>
      <h3 className="text-lg font-medium text-foreground">{title}</h3>
      <Separator className="mt-2" />
    </div>
    <div className="space-y-4">{children}</div>
  </div>
)

const VIDEO_MAP: [string, string][] = [
  ['AVC / H.264', 'x264'],
  ['HEVC / H.265', 'x265 (10bit HEVC → x265)'],
  ['AV1', 'AV1'],
  ['VP9', 'VP9'],
]

const AUDIO_MAP: [string, string][] = [
  ['E-AC-3 (DD+)', 'DDP'],
  ['AC-3', 'DD'],
  ['DTS / DTS-HD MA / DTS:X', 'DTS / DTS-HD MA / DTS:X'],
  ['TrueHD (+Atmos)', 'TrueHD (Atmos)'],
  ['AAC / FLAC / Opus / PCM', 'AAC / FLAC / Opus / PCM'],
]

const MapEditor: React.FC<{
  hint: string
  fromPlaceholder: string
  toPlaceholder: string
  value: Record<string, string>
  onChange: (next: Record<string, string>) => void
}> = ({ hint, fromPlaceholder, toPlaceholder, value, onChange }) => {
  const [fromKey, setFromKey] = useState('')
  const [toVal, setToVal] = useState('')
  const rows = Object.entries(value)

  const add = () => {
    const key = fromKey.trim().toLowerCase()
    const label = toVal.trim()
    if (!key || !label) return
    onChange({ ...value, [key]: label })
    setFromKey('')
    setToVal('')
  }
  const remove = (key: string) => {
    onChange(
      Object.fromEntries(Object.entries(value).filter(([k]) => k !== key))
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{hint}</p>
      {rows.length > 0 ? (
        <div className="space-y-1">
          {rows.map(([key, label]) => (
            <div key={key} className="flex items-center gap-2 text-sm">
              <span className="w-40 truncate font-mono text-muted-foreground">
                {key}
              </span>
              <span className="text-muted-foreground">→</span>
              <span className="flex-1 truncate text-foreground">{label}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => remove(key)}
                aria-label={`Remove override for ${key}`}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Input
          value={fromKey}
          onChange={event => setFromKey(event.target.value)}
          placeholder={fromPlaceholder}
          className="font-mono"
        />
        <span className="text-muted-foreground">→</span>
        <Input
          value={toVal}
          onChange={event => setToVal(event.target.value)}
          placeholder={toPlaceholder}
          onKeyDown={event => {
            if (event.key === 'Enter') add()
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={add}>
          Add
        </Button>
      </div>
    </div>
  )
}

export const NamingPane: React.FC = () => {
  const { data: preferences } = usePreferences()
  const savePreferences = useSavePreferences()
  const [sample, setSample] = useState(
    'Inception.2018.1080p.BluRay.DDP.5.1.x264-RaZoR.mkv'
  )

  const tokens = useMemo(() => parseFilenameTokens(sample), [sample])
  const tag = preferences?.selectedTag?.trim() || preferences?.tags?.[0] || ''
  const containerBase = [
    `${tokens.title}${tokens.year ? ` (${tokens.year})` : ''}`,
    tokens.seasonEpisode,
  ]
    .filter(Boolean)
    .join(' ')
    .trim()
  const containerTitle =
    tag && !preferences?.legacyContainerTitle
      ? `${containerBase} - Downloaded From ${tag}`
      : containerBase

  return (
    <div className="space-y-6">
      <SettingsSection title="Filename parser test">
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">
            Sample filename
          </Label>
          <Input
            value={sample}
            onChange={event => setSample(event.target.value)}
            placeholder="Paste a release filename"
          />
          <p className="text-sm text-muted-foreground">
            Shows what is parsed from the filename alone. Audio, codec and HDR
            come from the media stream (ffprobe) and appear in the queue
            preview.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          {(
            [
              ['Title', tokens.title],
              ['Year', tokens.year],
              ['Season/Ep', tokens.seasonEpisode],
              ['Source', tokens.source],
              ['Resolution', tokens.resolution],
              ['Group', tokens.group],
            ] as [string, string][]
          ).map(([label, value]) => (
            <div key={label} className="rounded-md bg-muted/40 p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {label}
              </div>
              <div className="truncate text-foreground">{value || '—'}</div>
            </div>
          ))}
        </div>
        <div className="rounded-md bg-muted/40 p-2 text-sm">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Embedded title
          </div>
          <div className="text-foreground">{containerTitle || '—'}</div>
        </div>
      </SettingsSection>

      <SettingsSection title="Embedded title">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label className="text-sm font-medium text-foreground">
              Use custom video-title template
            </Label>
            <p className="text-sm text-muted-foreground">
              Off (default): write “Title (Year) SxxExx - Downloaded From
              &lt;tag&gt;”. On: use the editable video-title template instead.
            </p>
          </div>
          <Switch
            checked={preferences?.legacyContainerTitle ?? false}
            onCheckedChange={checked =>
              savePreferences.mutate({ legacyContainerTitle: checked })
            }
          />
        </div>
      </SettingsSection>

      <SettingsSection title="Muxed suffix">
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">
            Default suffix appended to the release group (muxed mode)
          </Label>
          <Input
            key={preferences?.ionicSuffix ?? ''}
            defaultValue={preferences?.ionicSuffix ?? ''}
            placeholder="Ionicboy"
            onBlur={event =>
              savePreferences.mutate({ ionicSuffix: event.target.value.trim() })
            }
          />
          <p className="text-sm text-muted-foreground">
            Muxed names end with “(OriginalGroup-&lt;suffix&gt;)”. The Filename
            tag (chosen in General or on the Filenames tab) overrides this when
            set. VOD names keep the original group only.
          </p>
        </div>
      </SettingsSection>

      <SettingsSection title="Codec mapping reference">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1 text-sm">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Video
            </div>
            {VIDEO_MAP.map(([from, to]) => (
              <div key={from} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{from}</span>
                <span className="text-foreground">{to}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1 text-sm">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Audio
            </div>
            {AUDIO_MAP.map(([from, to]) => (
              <div key={from} className="flex justify-between gap-2">
                <span className="text-muted-foreground">{from}</span>
                <span className="text-foreground">{to}</span>
              </div>
            ))}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Custom overrides">
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">
            Video codec
          </Label>
          <MapEditor
            hint="Override the final video token by ffprobe codec name (e.g. hevc → H265, mpeg2video → MPEG2)."
            fromPlaceholder="hevc"
            toPlaceholder="H265"
            value={preferences?.videoCodecOverrides ?? {}}
            onChange={next =>
              savePreferences.mutate({ videoCodecOverrides: next })
            }
          />
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">
            Audio codec
          </Label>
          <MapEditor
            hint="Override the audio label by ffprobe codec name (e.g. opus → OPUS, eac3 → DD+)."
            fromPlaceholder="opus"
            toPlaceholder="OPUS"
            value={preferences?.audioCodecOverrides ?? {}}
            onChange={next =>
              savePreferences.mutate({ audioCodecOverrides: next })
            }
          />
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">
            Language
          </Label>
          <MapEditor
            hint="Override a language name by ISO code (e.g. fil → Filipino, pt-br → Portuguese)."
            fromPlaceholder="fil"
            toPlaceholder="Filipino"
            value={preferences?.languageOverrides ?? {}}
            onChange={next =>
              savePreferences.mutate({ languageOverrides: next })
            }
          />
        </div>
      </SettingsSection>
    </div>
  )
}

export default NamingPane
