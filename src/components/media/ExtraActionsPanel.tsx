import { useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { Loader2, Plus, Sparkles, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ToolSection } from '@/components/media/ToolSection'
import { usePreferences, useSavePreferences } from '@/services/preferences'
import {
  resolveMetadataFields,
  resolveMetadataValues,
  toTagName,
  type MetadataField,
} from '@/types/preferences'

interface ExtraActionsPanelProps {
  /** Queued file paths the metadata is written into when Execute runs. */
  paths: string[]
}

/**
 * "Extra Actions" — an editor for general/segment metadata permanently written into each
 * queued file's MediaInfo general section.
 *
 * Field labels are editable inline and custom fields can be added, so the set is driven by
 * preferences rather than hardcoded. Which fields appear is controlled in
 * Settings → Metadata; the grid reflows over whatever remains enabled.
 */
export function ExtraActionsPanel({ paths }: ExtraActionsPanelProps) {
  const { data: preferences } = usePreferences()
  const savePreferences = useSavePreferences()
  const [isWriting, setIsWriting] = useState(false)
  // Saved preferences are the source of truth; the drafts hold only in-flight edits so
  // typing stays responsive. Each is cleared on blur once the change is persisted, which
  // also lets a change made in Settings show up here immediately.
  const [fieldDraft, setFieldDraft] = useState<MetadataField[] | null>(null)
  const [valueDraft, setValueDraft] = useState<Record<string, string> | null>(
    null
  )

  const fields = fieldDraft ?? resolveMetadataFields(preferences?.metadataFields)
  const values =
    valueDraft ??
    resolveMetadataValues(
      preferences?.metadataValues,
      preferences?.generalMetadata
    )

  const visible = useMemo(() => fields.filter(f => f.enabled), [fields])

  const persistValues = (next: Record<string, string>) => {
    setValueDraft(null)
    if (JSON.stringify(next) === JSON.stringify(preferences?.metadataValues))
      return
    savePreferences.mutateAsync({ metadataValues: next })
  }

  const persistFields = (next: MetadataField[]) => {
    setFieldDraft(null)
    if (JSON.stringify(next) === JSON.stringify(preferences?.metadataFields))
      return
    savePreferences.mutateAsync({ metadataFields: next })
  }

  const renameField = (id: string, label: string) => {
    setFieldDraft(
      fields.map(field =>
        field.id === id
          ? {
              ...field,
              label,
              // A custom field's tag key follows its label; built-ins keep their fixed
              // destination so existing files stay consistent.
              tagName:
                field.builtIn || field.target !== 'tag'
                  ? field.tagName
                  : toTagName(label),
            }
          : field
      )
    )
  }

  const addField = () => {
    const id = `custom-${Date.now()}`
    const next: MetadataField[] = [
      ...fields,
      {
        id,
        label: 'New field',
        target: 'tag',
        tagName: 'NEW_FIELD',
        enabled: true,
        placeholder: 'Value',
        builtIn: false,
      },
    ]
    persistFields(next)
  }

  const removeField = (id: string) => {
    persistFields(fields.filter(field => field.id !== id))
    // Drop the removed field's value so a deleted field leaves nothing behind.
    persistValues(
      Object.fromEntries(Object.entries(values).filter(([key]) => key !== id))
    )
  }

  const filled = visible.filter(f => (values[f.id] ?? '').trim().length > 0)

  const handleExecute = async () => {
    if (isWriting) return
    if (paths.length === 0) {
      toast.error('No files in the queue to write metadata to.')
      return
    }
    if (filled.length === 0) {
      toast.error('Fill in at least one metadata field first.')
      return
    }
    persistValues(values)
    persistFields(fields)
    setIsWriting(true)
    try {
      // Only enabled, non-empty fields are sent; the backend writes exactly what it gets.
      const entries = filled.map(field => ({
        target: field.target,
        tagName: field.tagName,
        value: (values[field.id] ?? '').trim(),
      }))
      const items = paths.map(path => ({ path, entries }))
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

  return (
    <ToolSection
      title="Extra Actions"
      icon={<Sparkles className="h-3.5 w-3.5 shrink-0" />}
      summary={filled.length > 0 ? `${filled.length} set` : undefined}
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
      {visible.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/70">
          All fields are hidden. Enable them in Settings → Metadata.
        </p>
      ) : (
        <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map(field => (
            <div key={field.id} className="space-y-1">
              <div className="group flex items-center gap-1">
                {/* The label doubles as its own editor: borderless until hovered/focused so
                    the panel stays calm, but always directly editable. */}
                <input
                  value={field.label}
                  aria-label={`Rename ${field.label} field`}
                  title="Click to rename this field"
                  className="w-full min-w-0 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground outline-none hover:border-border/60 focus:border-border focus:bg-input focus:text-foreground"
                  onChange={event => renameField(field.id, event.target.value)}
                  onBlur={() => persistFields(fields)}
                />
                {!field.builtIn && (
                  <button
                    type="button"
                    aria-label={`Remove ${field.label} field`}
                    title="Remove this field"
                    onClick={() => removeField(field.id)}
                    className="shrink-0 rounded-sm p-0.5 text-muted-foreground/50 opacity-0 transition hover:bg-muted/40 hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <Input
                value={values[field.id] ?? ''}
                placeholder={field.placeholder}
                className="h-8 bg-input text-xs"
                onChange={event =>
                  setValueDraft({ ...values, [field.id]: event.target.value })
                }
                onBlur={() => persistValues(values)}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] leading-snug text-muted-foreground/70">
          Written permanently into each file&apos;s MediaInfo general section.
          Blank fields are left untouched. Click a label to rename it.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={addField}
          className="h-6 shrink-0 gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
          title="Add a custom global tag field"
        >
          <Plus className="h-3 w-3" />
          Add field
        </Button>
      </div>
    </ToolSection>
  )
}

export default ExtraActionsPanel
