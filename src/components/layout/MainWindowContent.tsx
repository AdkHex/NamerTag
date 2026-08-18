import { useState } from 'react'
import { cn } from '@/lib/utils'
import { BrowseLocalFiles } from '@/components/upload/BrowseLocalFiles'
import { GeneratedNamesPanel } from '@/components/media/GeneratedNamesPanel'
import { GeneratedFilenamesPanel } from '@/components/media/GeneratedFilenamesPanel'
import { useUIStore } from '@/store/ui-store'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { IconFileImport, IconFolderPlus } from '@tabler/icons-react'
import { useQueueActions } from '@/components/upload/useQueueActions'

interface MainWindowContentProps {
  children?: React.ReactNode
  className?: string
}

export function MainWindowContent({
  children,
  className,
}: MainWindowContentProps) {
  const leftSidebarVisible = useUIStore(s => s.leftSidebarVisible)
  const [activeTab, setActiveTab] = useState<'filenames' | 'tracks'>(
    'filenames'
  )
  const { handleAddFiles, handleAddFolder, isBrowsing } = useQueueActions()

  if (children) {
    return (
      <div className={cn('flex h-full flex-col bg-background', className)}>
        {children}
      </div>
    )
  }

  return (
    <div className={cn('flex h-full w-full bg-background p-3 pt-0', className)}>
      {leftSidebarVisible ? (
        <aside className="flex h-full w-[320px] shrink-0 flex-col rounded-xl bg-secondary p-2.5">
          <div className="px-1 pt-1 pb-1">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                File Queue
              </div>
              <TooltipProvider>
                <div className="flex items-center gap-2">
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={handleAddFiles}
                        disabled={isBrowsing}
                        className="h-7 w-7 text-muted-foreground hover:text-foreground focus-visible:ring-1 focus-visible:ring-accent"
                        aria-label="Add Files"
                      >
                        <IconFileImport size={18} stroke={1.6} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      align="end"
                      className="bg-card text-foreground border border-border text-[11px] "
                    >
                      Add Files
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={handleAddFolder}
                        disabled={isBrowsing}
                        className="h-7 w-7 text-muted-foreground hover:text-foreground focus-visible:ring-1 focus-visible:ring-accent"
                        aria-label="Add Folder"
                      >
                        <IconFolderPlus size={18} stroke={1.6} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      align="end"
                      className="bg-card text-foreground border border-border text-[11px]"
                    >
                      Add Folder
                    </TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-1 py-2">
            <BrowseLocalFiles showActionBar={false} variant="queue" />
          </div>
        </aside>
      ) : null}
      <div className={cn('min-w-0 flex-1', leftSidebarVisible ? 'ml-1' : '')}>
        <div className="flex h-full flex-col overflow-visible rounded-xl bg-card p-3">
          <div className="flex h-11 items-center gap-5 border-b border-border/60 px-1">
            <button
              type="button"
              onClick={() => setActiveTab('filenames')}
              className={cn(
                'text-sm font-medium text-muted-foreground transition-colors border-b-2 pb-2',
                activeTab === 'filenames'
                  ? 'text-foreground border-accent'
                  : 'border-transparent hover:text-foreground'
              )}
            >
              Filenames
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('tracks')}
              className={cn(
                'text-sm font-medium text-muted-foreground transition-colors border-b-2 pb-2',
                activeTab === 'tracks'
                  ? 'text-foreground border-accent'
                  : 'border-transparent hover:text-foreground'
              )}
            >
              Track Titles
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-1 pt-3">
            <div className={cn(activeTab === 'filenames' ? '' : 'hidden')}>
              <GeneratedFilenamesPanel />
            </div>
            <div className={cn(activeTab === 'tracks' ? '' : 'hidden')}>
              <GeneratedNamesPanel />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default MainWindowContent
