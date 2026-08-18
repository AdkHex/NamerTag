import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePreferences, useSavePreferences } from '@/services/preferences'

export function TagManager() {
  const { data: preferences } = usePreferences()
  const savePreferences = useSavePreferences()
  const [newTag, setNewTag] = useState('')

  const tags = useMemo(() => preferences?.tags ?? [], [preferences?.tags])
  const selectedTag = preferences?.selectedTag || tags[0] || ''
  const filenameTag = preferences?.filenameTag || tags[0] || ''
  const encoderName = preferences?.encoderName || ''
  const printType =
    (preferences?.printTypeOverride as 'BluRay' | 'WEB-DL' | '') || ''

  const handleSaveTag = async () => {
    const next = newTag.trim()
    if (!next) return
    const nextTags = Array.from(new Set([...tags, next]))
    await savePreferences.mutateAsync({
      tags: nextTags,
      selectedTag: next,
      filenameTag: filenameTag || next,
    })
    setNewTag('')
  }

  const handleDeleteTag = async () => {
    if (!selectedTag) return
    const nextTags = tags.filter(tag => tag !== selectedTag)
    const nextFilenameTag = nextTags.includes(filenameTag)
      ? filenameTag
      : (nextTags[0] ?? '')
    await savePreferences.mutateAsync({
      tags: nextTags,
      selectedTag: nextTags[0] ?? '',
      filenameTag: nextFilenameTag,
    })
  }

  const handleSelectionChange = async (value: string) => {
    await savePreferences.mutateAsync({ selectedTag: value })
  }

  const handleFilenameSelectionChange = async (value: string) => {
    await savePreferences.mutateAsync({ filenameTag: value })
  }

  const handleEncoderChange = async (value: string) => {
    await savePreferences.mutateAsync({ encoderName: value.trim() })
  }

  const handlePrintTypeChange = async (value: 'BluRay' | 'WEB-DL' | '') => {
    await savePreferences.mutateAsync({ printTypeOverride: value })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Tags</p>
          <p className="text-xs text-muted-foreground">
            Manage preset tags. The filename tag becomes the group suffix in the
            on-disk name; the track title tag goes into the embedded titles.
          </p>
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">
            Track title tag
          </Label>
          <p className="text-xs text-muted-foreground">
            Inner title — “… - Downloaded From &lt;tag&gt;”.
          </p>
          <Select
            key={`track-${selectedTag}-${tags.length}`}
            defaultValue={selectedTag}
            onValueChange={handleSelectionChange}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select tag" />
            </SelectTrigger>
            <SelectContent>
              {tags.length === 0 ? (
                <SelectItem value="__empty__" disabled>
                  No tags yet
                </SelectItem>
              ) : (
                tags.map(tag => (
                  <SelectItem key={tag} value={tag}>
                    {tag}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground">
            Filename tag
          </Label>
          <p className="text-xs text-muted-foreground">
            Outer name — the group suffix, “(Group-&lt;tag&gt;)”.
          </p>
          <Select
            key={`filename-${filenameTag}-${tags.length}`}
            defaultValue={filenameTag}
            onValueChange={handleFilenameSelectionChange}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select tag" />
            </SelectTrigger>
            <SelectContent>
              {tags.length === 0 ? (
                <SelectItem value="__empty__" disabled>
                  No tags yet
                </SelectItem>
              ) : (
                tags.map(tag => (
                  <SelectItem key={tag} value={tag}>
                    {tag}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Input
            placeholder="New tag"
            value={newTag}
            onChange={event => setNewTag(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleSaveTag}
              disabled={savePreferences.isPending || newTag.trim().length === 0}
            >
              Save
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleDeleteTag}
              disabled={savePreferences.isPending || !selectedTag}
            >
              Delete
            </Button>
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <Label className="text-sm font-medium text-foreground">
          Encoder name
        </Label>
        <Input
          key={encoderName}
          defaultValue={encoderName}
          onBlur={event => handleEncoderChange(event.target.value)}
          placeholder="Optional override"
        />
      </div>
      <div className="space-y-2">
        <Label className="text-sm font-medium text-foreground">
          Print type
        </Label>
        <Select
          key={`print-${printType}`}
          defaultValue={printType}
          onValueChange={value =>
            handlePrintTypeChange(
              value === '__auto__' ? '' : (value as 'BluRay' | 'WEB-DL')
            )
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Auto" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__auto__">Auto</SelectItem>
            <SelectItem value="BluRay">BluRay</SelectItem>
            <SelectItem value="WEB-DL">WEB-DL</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export default TagManager
