import {
  AlertTriangle,
  Mail,
  Moon,
  Redo2,
  Sun,
  Undo2,
  Upload,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useTheme } from '@/hooks/useTheme'

/** Only shown if the probe somehow reported failure without a reason. */
const UNSUPPORTED_FALLBACK = 'H.264 encode unavailable'

interface TopBarProps {
  projectName: string | null
  canExport: boolean
  supported: boolean | null
  /** Platform-aware explanation when `supported === false`. */
  unsupportedReason: string | null
  onExport: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
}

export function TopBar({
  projectName,
  canExport,
  supported,
  unsupportedReason,
  onExport,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: TopBarProps) {
  const { theme, toggle } = useTheme()
  return (
    <header className="flex h-[calc(3rem+env(safe-area-inset-top))] shrink-0 items-center gap-2 border-b border-edge bg-surface pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] sm:gap-3">
      <div className="flex items-center gap-2.5">
        <img
          src="/app-icon-192.png?v=2"
          alt="Captions Bro"
          width={28}
          height={28}
          decoding="async"
          className="h-7 w-7 shrink-0 rounded-lg shadow-[0_2px_8px_-2px_rgba(0,0,0,0.5)]"
        />
        {/* The icon carries the brand on a phone; the wordmark costs ~105px. */}
        <span className="hidden text-sm font-semibold tracking-tight text-ink sm:inline">
          Captions Bro
        </span>
      </div>

      <div className="hidden h-4 w-px shrink-0 bg-edge sm:block" />

      <span className="min-w-0 flex-1 truncate text-xs text-muted">
        {projectName ?? 'Untitled project'}
      </span>

      {/* Never hidden. This used to be `hidden sm:flex`, which made it invisible
          on exactly the devices where encoding fails — leaving a greyed-out
          Export button with no explanation. Below sm it collapses to the icon,
          with the reason still in the accessible name (and in a toast, fired
          once from useExport's probe). */}
      {supported === false && (
        <Badge
          variant="warning"
          title={unsupportedReason ?? UNSUPPORTED_FALLBACK}
          className="flex shrink-0 items-center gap-1.5"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {/* Visible from sm up; below that the icon carries it visually while
              the text stays in the accessible name. */}
          <span className="sr-only sm:not-sr-only">
            {unsupportedReason ?? UNSUPPORTED_FALLBACK}
          </span>
        </Badge>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={
              theme === 'dark'
                ? 'Switch to light theme'
                : 'Switch to dark theme'
            }
            className="h-7 w-7 shrink-0"
          >
            {theme === 'dark' ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {theme === 'dark' ? 'Light theme' : 'Dark theme'}
        </TooltipContent>
      </Tooltip>

      {/* Marketing, not an editing tool — the first thing to shed on a phone. */}
      <Button
        variant="ghost"
        size="sm"
        asChild
        className="hidden shrink-0 lg:inline-flex"
      >
        <a href="mailto:info@ninevastudios.com">
          <Mail className="h-3.5 w-3.5" />
          Contact
        </a>
      </Button>

      <div className="hidden h-4 w-px shrink-0 bg-edge lg:block" />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Undo"
            className="h-7 w-7 shrink-0"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Undo (⌘Z)</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="Redo"
            className="h-7 w-7 shrink-0"
          >
            <Redo2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Redo (⌘⇧Z)</TooltipContent>
      </Tooltip>

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
