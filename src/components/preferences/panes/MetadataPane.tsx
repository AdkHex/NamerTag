import React, { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { usePreferences, useSavePreferences } from '@/services/preferences'
import {
  defaultMetadataFields,
  resolveMetadataFields,
  toTagName,
  type MetadataField,
} from '@/types/preferences'

/**
 * Settings → Metadata: choose which "Extra Actions" fields exist and which are shown.
 *
 * Disabling a field hides it from the Extra Actions panel and excludes it from writes; the
 * panel's grid reflows over whatever remains. Built-in fields can be renamed or hidden but
 * not deleted, since each maps to a fixed container destination.
 */
export const MetadataPane: React.FC = () => {
  const { data: preferences } = usePreferences()
  const savePreferences = useSavePreferences()
  // Saved preferences are the source of truth. `draft` holds only in-flight label edits so
  // typing stays responsive; it is cleared on blur once the value is persisted.
  const [draft, setDraft] = useState<MetadataField[] | null>(null)
  const fields = draft ?? resolveMetadataFields(preferences?.metadataFields)

  const persist = (next: MetadataField[]) => {
    setDraft(null)
    if (JSON.stringify(next) === JSON.stringify(preferences?.metadataFields))
      return
    savePreferences.mutateAsync({ metadataFields: next })
  }

  const update = (id: string, patch: Partial<MetadataField>) => {
    setDraft(
      fields.map(field => (field.id === id ? { ...field, ...patch } : field))
    )
  }

  const destinationLabel = (field: MetadataField) => {
    if (field.target === 'writing-application') return 'Segment: writing application'
    if (field.target === 'muxing-application') return 'Segment: muxing application'
    return `Global tag: ${field.tagName || '—'}`
  }

  const addField = () => {
    persist([
      ...fields,
      {
        id: `custom-${Date.now()}`,
        label: 'New field',
        target: 'tag',
        tagName: 'NEW_FIELD',
        enabled: true,
        placeholder: 'Value',
        builtIn: false,
      },
    ])
  }

  const enabledCount = fields.filter(field => field.enabled).length

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium text-foreground">Extra Actions fields</h3>
        <Separator className="mt-2" />
      </div>

      <p className="text-sm text-muted-foreground">
        Choose which fields appear in the Extra Actions panel. Hidden fields are
        never written. {enabledCount} of {fields.length} shown.
      </p>

      <div className="space-y-2">
        {fields.map(field => (
          <div
            key={field.id}
            className="flex items-center gap-3 rounded-md border border-border/60 bg-card/40 px-3 py-2"
          >
            <Switch
              checked={field.enabled}
              onCheckedChange={checked => {
                const next = fields.map(f =>
                  f.id === field.id ? { ...f, enabled: checked } : f
                )
                persist(next)
              }}
              aria-label={`Show ${field.label}`}
            />
            <div className="min-w-0 flex-1 space-y-1">
              <Input
                value={field.label}
                className="h-8 text-sm"
                aria-label={`${field.label} label`}
                onChange={event =>
                  update(field.id, {
                    label: event.target.value,
                    // Custom tag keys track the label; built-ins keep their fixed key.
                    ...(field.builtIn || field.target !== 'tag'
                      ? {}
                      : { tagName: toTagName(event.target.value) }),
                  })
                }
                onBlur={() => persist(fields)}
              />
              <p className="truncate text-xs text-muted-foreground">
                {destinationLabel(field)}
                {field.builtIn ? ' · built-in' : ''}
              </p>
            </div>
            {!field.builtIn && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Delete ${field.label}`}
                onClick={() =>
                  persist(fields.filter(f => f.id !== field.id))
                }
                className="h-7 shrink-0 px-2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addField}
          className="gap-1"
        >
          <Plus className="h-3.5 w-3.5" />
          Add field
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => persist(defaultMetadataFields)}
          className="text-muted-foreground hover:text-foreground"
          title="Restore the five built-in fields and remove custom ones"
        >
          Reset to defaults
        </Button>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium text-foreground">
          How fields are stored
        </Label>
        <p className="text-sm text-muted-foreground">
          Writing and muxing application are Matroska segment properties. Every
          other field is written as a global tag, which is also how custom
          fields are stored. In MP4 and MOV the writing application maps to the
          portable <code className="text-xs">encoder</code> key; there is no
          muxing-application equivalent, so that field is skipped for those
          containers.
        </p>
      </div>
    </div>
  )
}

export default MetadataPane
