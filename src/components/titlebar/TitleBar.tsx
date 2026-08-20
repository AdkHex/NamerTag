import { useState } from 'react'
import { cn } from '@/lib/utils'
import { MacOSWindowControls } from './MacOSWindowControls'
import { WindowsWindowControls } from './WindowsWindowControls'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useUIStore } from '@/store/ui-store'
import {
  IconDownload,
  IconLayoutSidebar,
  IconLoader2,
  IconSettings,
  IconTrash,
} from '@tabler/icons-react'
import { installUpdate } from '@/lib/updater'
import { useQueueActions } from '@/components/upload/useQueueActions'
import { APP_ATTRIBUTION, APP_NAME } from '@/lib/app-info'

interface TitleBarProps {
  className?: string
  title?: string
}

export function TitleBar({ className, title = APP_NAME }: TitleBarProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const {
    leftSidebarVisible,
    toggleLeftSidebar,
    setPreferencesOpen,
    updateReady,
    updateDownloading,
    updateVersion,
    updateProgress,
  } = useUIStore()
  const { hasItems, handleClear } = useQueueActions()
  const platformName = detectPlatform()

  return (
    <div
      data-tauri-drag-region
      className={cn(
        'relative flex h-10 w-full shrink-0 items-center justify-between  bg-background',
        className
      )}
    >
      {/* Left side - Window Controls */}
      <div className="flex items-center">
        {platformName === 'macos' ? <MacOSWindowControls /> : null}
      </div>

      {/* Center - Title. The attribution sits on the same baseline in smaller, dimmer
          type so it reads as a subtitle rather than part of the product name. */}
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-baseline gap-1.5">
        <span className="text-sm font-medium text-foreground/80">{title}</span>
        <span className="text-[10px] font-normal tracking-wide text-foreground/45">
          {APP_ATTRIBUTION}
        </span>
      </div>

      {/* Right side - Actions */}
      <div className="flex items-center gap-2 pr-2">
        {updateDownloading ? (
          <div
            className="flex items-center gap-1 text-foreground/70 text-xs"
            title={
              updateProgress !== null
                ? `Downloading update (${updateProgress}%)`
                : 'Downloading update'
            }
          >
            <IconLoader2 size={14} stroke={1.8} className="animate-spin" />
            {updateProgress !== null ? `${updateProgress}%` : 'Downloading…'}
          </div>
        ) : null}
        {updateReady ? (
          <Button
            onClick={async () => {
              setConfirmOpen(true)
            }}
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-foreground/80 hover:text-foreground"
            title={
              updateVersion
                ? `Restart to update (${updateVersion})`
                : 'Restart to update'
            }
          >
            <IconDownload size={14} stroke={1.8} />
          </Button>
        ) : null}
        <Button
          onClick={handleClear}
          variant="ghost"
          size="icon"
          className="h-8 w-8 p-0 text-foreground/70 hover:bg-card hover:text-foreground"
          title="Clear Queue"
          disabled={!hasItems}
        >
          <IconTrash size={18} stroke={1.8} className="!h-4.5 !w-4.5" />
        </Button>
        <Button
          onClick={toggleLeftSidebar}
          variant="ghost"
          size="icon"
          className="h-8 w-8 p-0 text-foreground/70 hover:bg-card hover:text-foreground"
          title={leftSidebarVisible ? 'Hide Left Sidebar' : 'Show Left Sidebar'}
        >
          <IconLayoutSidebar size={20} stroke={1.8} className="!h-5 !w-5" />
        </Button>
        <Button
          onClick={() => setPreferencesOpen(true)}
          variant="ghost"
          size="icon"
          className="h-8 w-8 p-0 text-foreground/70 hover:bg-card hover:text-foreground"
          title="Settings"
        >
          <IconSettings size={20} stroke={1.8} className="!h-5 !w-5" />
        </Button>
        {platformName === 'windows' ? (
          <WindowsWindowControls className="ml-2" />
        ) : null}
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart to update?</AlertDialogTitle>
            <AlertDialogDescription>
              {APP_NAME} will restart to install the update.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Later</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await installUpdate()
              }}
            >
              Restart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default TitleBar

function detectPlatform(): 'macos' | 'windows' | null {
  const platform = navigator.platform.toLowerCase()
  if (platform.includes('mac')) return 'macos'
  if (platform.includes('win')) return 'windows'

  const userAgent = navigator.userAgent.toLowerCase()
  if (userAgent.includes('mac')) return 'macos'
  if (userAgent.includes('windows')) return 'windows'

  return null
}
