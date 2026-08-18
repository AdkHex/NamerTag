import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { Loader2, Sparkles } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { ToolSection } from '@/components/media/ToolSection'
import { usePreferences, useSavePreferences } from '@/services/preferences'
import {
  defaultGeneralMetadata,
  type GeneralMetadata,
} from '@/types/preferences'

interface ExtraActionsPanelProps {
  /** Queued file paths the metadata is written into when Execute runs. */
  paths: string[]
}

interface MetadataField {
  key: keyof GeneralMetadata
  label: string
  placeholder: string
}

// MediaInfo "general" fields, in display order. writing/muxing land in the segment info;
// website/encodedBy/telegram become global tags (WEBSITE / ENCODED_BY / TELEGRAM).
const FIELDS: MetadataField[] = [
  {
    key: 'writingApplication',
    label: 'Writing application',
    placeholder: 'e.g. mkvmerge',
  },
  {
    key: 'muxingApplication',
    label: 'Writing library',
    placeholder: 'e.g. Ionicboy',
  },
  { key: 'website', label: 'Website', placeholder: 'e.g. example.com' },
  { key: 'encodedBy', label: 'Encoded by', placeholder: 'e.g. Ionicboy' },
  { key: 'telegram', label: 'Telegram', placeholder: 'e.g. @ionicboy' },
]

/**
 * "Extra Actions" — a compact editor for general/segment metadata that is permanently written
 * into each queued file's MediaInfo general section. Values are persisted in preferences (so the
 * release branding is remembered and editable) and applied to every queued file on Execute.
 */
export function ExtraActionsPanel({ paths }: ExtraActionsPanelProps) {
  const { data: preferences } = usePreferences()
  const savePreferences = useSavePreferences()
  const [draft, setDraft] = useState<GeneralMetadata>(defaultGeneralMetadata)
  const [isWriting, setIsWriting] = useState(false)

  // Keep the local draft in sync when preferences load or change elsewhere.
  useEffect(() => {
    if (preferences?.generalMetadata) {
      setDraft({ ...defaultGeneralMetadata, ...preferences.generalMetadata })
    }
  }, [preferences?.generalMetadata])

  const persist = (next: GeneralMetadata) => {
    if (
      JSON.stringify(next) ===
      JSON.stringify(preferences?.generalMetadata ?? {})
    ) {
      return
    }
    savePreferences.mutateAsync({ generalMetadata: next })
  }

  const hasValues = FIELDS.some(field => draft[field.key].trim().length > 0)

  const handleExecute = async () => {
    if (isWriting) return
    if (paths.length === 0) {
      toast.error('No files in the queue to write metadata to.')
      return
    }
    if (!hasValues) {
      toast.error('Fill in at least one metadata field first.')
      return
    }
    persist(draft)
    setIsWriting(true)
    try {
      const items = paths.map(path => ({ path, ...draft }))
      const results = await invoke<
        { path: string; success: boolean; error?: string | null }[]
      >('write_general_metadata', { items })
      const failed = results.filter(result => !result.success)
      if (failed.length === 0) {
        toast.success(`Wrote metadata to ${results.length} files`)
      } else {
        toast.error(`Failed to write ${failed.length} of ${results.length}`, {
          description: failed[0]?.error ?? undefined,
        })
      }
    } catch (error) {
      toast.error('Failed to write metadata', {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setIsWriting(false)
    }
  }

  const filledCount = FIELDS.filter(
    field => draft[field.key].trim().length > 0
  ).length

  return (
    <ToolSection
      title="Extra Actions"
      icon={<Sparkles className="h-3.5 w-3.5 shrink-0" />}
      summary={filledCount > 0 ? `${filledCount} set` : undefined}
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleExecute}
          disabled={isWriting || paths.length === 0}
          className="h-7 border-border/70 bg-input text-xs hover:bg-muted/40"
          title="Permanently write these values into every queued file's general metadata"
        >
          {isWriting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            'Execute'
          )}
        </Button>
      }
    >
      <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map(field => (
          <div key={field.key} className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {field.label}
            </Label>
            <Input
              value={draft[field.key]}
              placeholder={field.placeholder}
              className="h-8 bg-input text-xs"
              onChange={event =>
                setDraft(prev => ({ ...prev, [field.key]: event.target.value }))
              }
              onBlur={() => persist(draft)}
            />
          </div>
        ))}
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground/70">
        Written permanently into each file&apos;s MediaInfo general section.
        Blank fields are left untouched.
      </p>
    </ToolSection>
  )
}

export default ExtraActionsPanel
