import { Upload, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface TopBarProps {
  projectName: string | null
  canExport: boolean
  supported: boolean | null
  exporting: { progress: number } | null
  onExport: () => void
  onCancelExport: () => void
}

export function TopBar({
  projectName,
  canExport,
  supported,
  exporting,
  onExport,
  onCancelExport,
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

      {exporting ? (
        <div className="flex w-72 shrink-0 items-center gap-2.5 rounded-lg border border-edge bg-bg px-3 py-1.5">
          <span className="shrink-0 text-[11px] text-muted">
            {exporting.progress >= 0.99 ? 'Finalizing…' : 'Encoding…'}
          </span>
          <Progress
            value={Math.max(2, exporting.progress * 100)}
            className="min-w-0 flex-1"
          />
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-accent">
            {Math.round(exporting.progress * 100)}%
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onCancelExport}
                aria-label="Cancel export"
                className="h-6 w-6"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Cancel export</TooltipContent>
          </Tooltip>
        </div>
      ) : (
        <Button
          onClick={onExport}
          disabled={!canExport || supported === false}
          className="shrink-0"
        >
          <Upload className="h-4 w-4" />
          Export
        </Button>
      )}
    </header>
  )
}
