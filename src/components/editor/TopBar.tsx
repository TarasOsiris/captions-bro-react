import { Mail, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface TopBarProps {
  projectName: string | null
  canExport: boolean
  supported: boolean | null
  onExport: () => void
}

export function TopBar({
  projectName,
  canExport,
  supported,
  onExport,
}: TopBarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-edge bg-surface px-3">
      <div className="flex items-center gap-2.5">
        <img
          src="/app-icon-192.png?v=2"
          alt="Captions Bro"
          width={28}
          height={28}
          decoding="async"
          className="h-7 w-7 shrink-0 rounded-lg shadow-[0_2px_8px_-2px_rgba(0,0,0,0.5)]"
        />
        <span className="text-sm font-semibold tracking-tight text-ink">
          Captions Bro
        </span>
      </div>

      <div className="h-4 w-px shrink-0 bg-edge" />

      <span className="min-w-0 flex-1 truncate text-xs text-muted">
        {projectName ?? 'Untitled project'}
      </span>

      {supported === false && (
        <Badge variant="warning" className="hidden shrink-0 sm:flex">
          H.264 encode unavailable — try Chrome
        </Badge>
      )}

      <Button variant="ghost" size="sm" asChild className="shrink-0">
        <a href="mailto:info@ninevastudios.com">
          <Mail className="h-3.5 w-3.5" />
          Contact
        </a>
      </Button>

      <Button
        onClick={onExport}
        disabled={!canExport || supported === false}
        className="shrink-0"
      >
        <Upload className="h-4 w-4" />
        Export
      </Button>
    </header>
  )
}
