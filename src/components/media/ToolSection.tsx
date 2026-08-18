import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ToolSectionProps {
  /** Uppercase section label shown on the header row. */
  title: string
  /** Optional leading glyph, rendered before the title. */
  icon?: ReactNode
  /** Short status shown on the header while collapsed, e.g. "3 fields set". */
  summary?: string
  /** Action rendered at the right of the header — stays reachable without expanding. */
  action?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}

/**
 * A collapsed-by-default tool container. The Filenames tab stacks several of these above the
 * results; keeping them shut by default means the generated filenames stay the first thing on
 * screen, which matters most in the common single-file case. Header stays a single 32px row so
 * a closed section costs almost nothing vertically.
 */
export function ToolSection({
  title,
  icon,
  summary,
  action,
  defaultOpen = false,
  children,
}: ToolSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="rounded-md border border-border/60 bg-secondary/35">
      <div className="flex h-9 items-center gap-2 pr-2">
        <button
          type="button"
          onClick={() => setOpen(value => !value)}
          aria-expanded={open}
          className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 transition-transform',
              open && 'rotate-90'
            )}
          />
          {icon}
          <span className="shrink-0">{title}</span>
          {summary && !open ? (
            <span className="truncate text-[10px] font-normal normal-case tracking-normal text-muted-foreground/60">
              {summary}
            </span>
          ) : null}
        </button>
        {action}
      </div>
      {open ? <div className="space-y-3 px-3 pb-3">{children}</div> : null}
    </div>
  )
}

export default ToolSection
