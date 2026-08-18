import { Separator } from '@/components/ui/separator'

interface LayoutProps {
  left: React.ReactNode
  right: React.ReactNode
}

export function Layout({ left, right }: LayoutProps) {
  return (
    <div className="flex h-full w-full flex-col gap-0 p-0">
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_auto_1fr] gap-4">
        <div className="flex min-h-0 flex-col overflow-hidden">{left}</div>
        <Separator orientation="vertical" className="h-full" />
        <div className="flex min-h-0 flex-col overflow-hidden">{right}</div>
      </div>
    </div>
  )
}

export default Layout
