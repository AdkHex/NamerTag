import { Button } from '@/components/ui/button'
import { FolderOpen, Trash2, Wand2, Pencil, RefreshCcw } from 'lucide-react'

interface ActionBarProps {
  isBrowsing: boolean
  isRenaming: boolean
  isRetagging: boolean
  hasItems: boolean
  onBrowse: () => void
  onClear: () => void
  onGenerate: () => void
  onRetag: () => void
  onRenameAll: () => void
}

export function ActionBar({
  isBrowsing,
  isRenaming,
  isRetagging,
  hasItems,
  onBrowse,
  onClear,
  onGenerate,
  onRetag,
  onRenameAll,
}: ActionBarProps) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onBrowse}
        disabled={isBrowsing}
        className="h-8 w-8 text-sky-400 hover:bg-card hover:text-sky-300"
        title={isBrowsing ? 'Browsing…' : 'Browse'}
      >
        <FolderOpen className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClear}
        disabled={!hasItems}
        className="h-8 w-8 text-slate-400 hover:bg-card hover:text-slate-300"
        title="Clear"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onGenerate}
        disabled={!hasItems}
        className="h-8 w-8 text-emerald-400 hover:bg-card hover:text-emerald-300"
        title="Generate"
      >
        <Wand2 className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRetag}
        disabled={!hasItems || isRetagging}
        className="h-8 w-8 text-indigo-400 hover:bg-card hover:text-indigo-300"
        title={isRetagging ? 'Retagging…' : 'Retag'}
      >
        <RefreshCcw className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRenameAll}
        disabled={!hasItems || isRenaming}
        className="h-8 w-8 text-amber-400 hover:bg-card hover:text-amber-300"
        title={isRenaming ? 'Renaming…' : 'Rename All'}
      >
        <Pencil className="h-4 w-4" />
      </Button>
    </div>
  )
}

export default ActionBar
