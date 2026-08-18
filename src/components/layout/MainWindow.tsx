import { TitleBar } from '@/components/titlebar/TitleBar'
import { MainWindowContent } from './MainWindowContent'
import { PreferencesDialog } from '@/components/preferences/PreferencesDialog'
import { Toaster } from 'sonner'
import { useTheme } from '@/hooks/use-theme'
import { useMainWindowEventListeners } from '@/hooks/useMainWindowEventListeners'

export function MainWindow() {
  const { theme } = useTheme()

  // Set up global event listeners (keyboard shortcuts, etc.)
  useMainWindowEventListeners()

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden rounded-xl bg-background">
      {/* Title Bar */}
      <TitleBar />

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden">
        <MainWindowContent className="w-full" />
      </div>

      {/* Global UI Components (hidden until triggered) */}
      <PreferencesDialog />
      <Toaster
        position="bottom-right"
        theme={
          theme === 'dark' || theme === 'gruvbox-dark'
            ? 'dark'
            : theme === 'light' || theme === 'gruvbox-light'
              ? 'light'
              : 'system'
        }
        className="toaster group"
        toastOptions={{
          unstyled: true,
          classNames: {
            toast:
              'group toast flex w-full items-start gap-3 rounded-lg border border-border/80 bg-card px-4 py-3 text-foreground shadow-lg',
            title: 'text-sm font-semibold',
            description: 'group-[.toast]:text-muted-foreground',
            actionButton:
              'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
            cancelButton:
              'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
            success:
              'group-[.toast]:border-accent/70 group-[.toast]:bg-accent/10',
            error:
              'group-[.toast]:border-destructive/70 group-[.toast]:bg-destructive/10',
            warning:
              'group-[.toast]:border-primary/40 group-[.toast]:bg-primary/10',
            info: 'group-[.toast]:border-primary/40 group-[.toast]:bg-primary/10',
          },
        }}
      />
    </div>
  )
}

export default MainWindow
