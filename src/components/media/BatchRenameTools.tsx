import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { ToolSection } from '@/components/media/ToolSection'
import { useGeneratedNamesStore } from '@/store/generated-names-store'

// Where added text lands. `before`/`after` insert relative to an anchor substring so text
// can go anywhere in the name, not only the two ends.
type AddPosition = 'prefix' | 'suffix' | 'before' | 'after'

interface BatchRenameToolsProps {
  /** Paths of the files currently in the queue — the rows the tools act on. */
  paths: string[]
}

// One run of characters in a before/after preview, tagged with how it changed.
type DiffKind = 'same' | 'add' | 'remove'
interface DiffPart {
  text: string
  kind: DiffKind
}

/** Insert `text` into `name` according to the chosen position/anchor. Returns name unchanged
 * when an anchor is required but not found, so a missing anchor never mangles a row. */
function applyAdd(
  name: string,
  text: string,
  position: AddPosition,
  anchor: string
): string {
  if (position === 'prefix') return `${text} ${name}`
  if (position === 'suffix') return `${name} ${text}`
  if (!anchor) return name
  const idx = name.indexOf(anchor)
  if (idx < 0) return name
  if (position === 'before') {
    return `${name.slice(0, idx)}${text} ${name.slice(idx)}`
  }
  const end = idx + anchor.length
  return `${name.slice(0, end)} ${text}${name.slice(end)}`
}

/** Build the unified diff (same / removed / added runs) for an add operation, mirroring
 * exactly what `applyAdd` does so the preview can never disagree with the real change. */
function diffAdd(
  name: string,
  text: string,
  position: AddPosition,
  anchor: string
): DiffPart[] {
  if (position === 'prefix') {
    return [
      { text: `${text} `, kind: 'add' },
      { text: name, kind: 'same' },
    ]
  }
  if (position === 'suffix') {
    return [
      { text: name, kind: 'same' },
      { text: ` ${text}`, kind: 'add' },
    ]
  }
  if (!anchor) return [{ text: name, kind: 'same' }]
  const idx = name.indexOf(anchor)
  if (idx < 0) return [{ text: name, kind: 'same' }]
  if (position === 'before') {
    return [
      { text: name.slice(0, idx), kind: 'same' },
      { text: `${text} `, kind: 'add' },
      { text: name.slice(idx), kind: 'same' },
    ]
  }
  const end = idx + anchor.length
  return [
    { text: name.slice(0, end), kind: 'same' },
    { text: ` ${text}`, kind: 'add' },
    { text: name.slice(end), kind: 'same' },
  ]
}

/** Plain text replace-all (split/join, never a regex). */
function applyReplace(name: string, find: string, replace: string): string {
  return name.split(find).join(replace)
}

/** Unified diff for a replace: each matched `find` shows struck-through, each `replace`
 * shows added, in place. */
function diffReplace(name: string, find: string, replace: string): DiffPart[] {
  if (!find) return [{ text: name, kind: 'same' }]
  const segments = name.split(find)
  const parts: DiffPart[] = []
  segments.forEach((segment, i) => {
    if (segment) parts.push({ text: segment, kind: 'same' })
    if (i < segments.length - 1) {
      parts.push({ text: find, kind: 'remove' })
      if (replace) parts.push({ text: replace, kind: 'add' })
    }
  })
  return parts
}

function DiffLine({ parts }: { parts: DiffPart[] }) {
  return (
    <div className="break-all font-mono text-[11px] leading-relaxed">
      {parts.map((part, i) => (
        <span
          key={i}
          className={cn(
            part.kind === 'add' &&
              'rounded-sm bg-emerald-500/20 text-emerald-300',
            part.kind === 'remove' &&
              'rounded-sm bg-red-500/20 text-red-300 line-through',
            part.kind === 'same' && 'text-foreground/80'
          )}
        >
          {part.text}
        </span>
      ))}
    </div>
  )
}

/**
 * Batch editing for the already-generated filenames: find/replace existing text across every
 * row, or add text at the start/end of every row — or before/after an anchor substring so it
 * can land anywhere in between. Every pending edit is previewed live (red = removed,
 * green = added) before it is applied. Operates on the in-memory generated names (the editable
 * base, no extension) — nothing is written to disk until Rename is pressed.
 */
export function BatchRenameTools({ paths }: BatchRenameToolsProps) {
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [addText, setAddText] = useState('')
  const [position, setPosition] = useState<AddPosition>('suffix')
  const [anchor, setAnchor] = useState('')
  // Subscribe (not getState) so the preview re-renders as names change.
  const entries = useGeneratedNamesStore(s => s.entries)

  const needsAnchor = position === 'before' || position === 'after'
  const disabled = paths.length === 0

  // Current non-empty generated names, in queue order — the rows every tool acts on.
  const names = useMemo(
    () =>
      paths
        .map(path => ({ path, name: entries[path]?.generatedName ?? '' }))
        .filter(row => row.name),
    [paths, entries]
  )

  // Live preview of the replace op: only rows that actually change, capped for compactness.
  const replacePreview = useMemo(() => {
    if (!find) return []
    return names
      .filter(row => row.name.includes(find))
      .slice(0, 6)
      .map(row => ({
        path: row.path,
        parts: diffReplace(row.name, find, replace),
      }))
  }, [names, find, replace])

  // Live preview of the add op: rows that actually change (anchor present when required).
  const addPreview = useMemo(() => {
    const text = addText.trim()
    if (!text) return []
    if (needsAnchor && !anchor) return []
    return names
      .filter(row => {
        const next = applyAdd(row.name, text, position, anchor)
        return next !== row.name
      })
      .slice(0, 6)
      .map(row => ({
        path: row.path,
        parts: diffAdd(row.name, text, position, anchor),
      }))
  }, [names, addText, position, anchor, needsAnchor])

  // Apply a transform to every queued row's generated name, skipping empty rows, and report
  // how many were affected so the action never silently does nothing.
  const applyToAll = (
    transform: (name: string) => string,
    emptyMessage: string
  ) => {
    const { entries: current, setGeneratedName } =
      useGeneratedNamesStore.getState()
    let changed = 0
    for (const path of paths) {
      const name = current[path]?.generatedName ?? ''
      if (!name) continue
      const next = transform(name)
      if (next !== name) {
        setGeneratedName(path, next)
        changed += 1
      }
    }
    if (changed === 0) {
      toast.info(emptyMessage)
    } else {
      toast.success(`Updated ${changed} filename${changed > 1 ? 's' : ''}`)
    }
  }

  const handleReplace = () => {
    if (!find) {
      toast.error('Enter the text to find first.')
      return
    }
    applyToAll(
      name => applyReplace(name, find, replace),
      `No filename contained "${find}".`
    )
  }

  const handleAdd = () => {
    const text = addText.trim()
    if (!text) {
      toast.error('Enter the text to add first.')
      return
    }
    if (needsAnchor && !anchor.trim()) {
      toast.error('Enter the anchor text to insert next to.')
      return
    }
    applyToAll(
      name => applyAdd(name, text, position, anchor.trim()),
      needsAnchor
        ? `No filename contained "${anchor.trim()}".`
        : 'No generated filenames to add text to.'
    )
  }

  return (
    <ToolSection title="Batch rename">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[140px] flex-1 space-y-1">
          <Label className="text-[11px] text-muted-foreground">Find</Label>
          <Input
            value={find}
            onChange={event => setFind(event.target.value)}
            placeholder="Existing text"
            className="h-9 bg-input"
          />
        </div>
        <div className="min-w-[140px] flex-1 space-y-1">
          <Label className="text-[11px] text-muted-foreground">
            Replace with
          </Label>
          <Input
            value={replace}
            onChange={event => setReplace(event.target.value)}
            placeholder="New text (blank removes)"
            className="h-9 bg-input"
            onKeyDown={event => {
              if (event.key === 'Enter') handleReplace()
            }}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleReplace}
          disabled={disabled}
          className="h-9 border-border/70 bg-input hover:bg-muted/40"
        >
          Replace all
        </Button>
      </div>
      {replacePreview.length > 0 ? (
        <div className="space-y-1 rounded-md border border-border/50 bg-background/40 p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Preview
          </div>
          {replacePreview.map(row => (
            <DiffLine key={row.path} parts={row.parts} />
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px] flex-1 space-y-1">
          <Label className="text-[11px] text-muted-foreground">Add text</Label>
          <Input
            value={addText}
            onChange={event => setAddText(event.target.value)}
            placeholder="Text to add to every name"
            className="h-9 bg-input"
            onKeyDown={event => {
              if (event.key === 'Enter') handleAdd()
            }}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Position</Label>
          <Select
            value={position}
            onValueChange={value => setPosition(value as AddPosition)}
          >
            <SelectTrigger className="h-9 w-36 bg-input">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="prefix">At start</SelectItem>
              <SelectItem value="suffix">At end</SelectItem>
              <SelectItem value="before">Before text…</SelectItem>
              <SelectItem value="after">After text…</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {needsAnchor ? (
          <div className="min-w-[160px] flex-1 space-y-1">
            <Label className="text-[11px] text-muted-foreground">
              {position === 'before' ? 'Insert before' : 'Insert after'}
            </Label>
            <Input
              value={anchor}
              onChange={event => setAnchor(event.target.value)}
              placeholder="Anchor text in the name"
              className="h-9 bg-input"
              onKeyDown={event => {
                if (event.key === 'Enter') handleAdd()
              }}
            />
          </div>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAdd}
          disabled={disabled}
          className="h-9 border-border/70 bg-input hover:bg-muted/40"
        >
          Add
        </Button>
      </div>
      {addPreview.length > 0 ? (
        <div className="space-y-1 rounded-md border border-border/50 bg-background/40 p-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Preview
          </div>
          {addPreview.map(row => (
            <DiffLine key={row.path} parts={row.parts} />
          ))}
        </div>
      ) : null}
    </ToolSection>
  )
}

export default BatchRenameTools
