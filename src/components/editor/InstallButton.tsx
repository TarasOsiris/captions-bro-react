import { Share, SquarePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'

/**
 * "Install app" in the TopBar. Renders NOTHING unless there is something to
 * offer — already installed, or a browser with no install path at all, and it
 * takes no space.
 *
 * Two shapes, because the platforms give us two different amounts of rope:
 * Chromium replays the captured `beforeinstallprompt`; iOS Safari has no API,
 * so the button opens a popover describing the Share-sheet steps. The steps
 * live IN the popover rather than a tooltip on purpose — Radix tooltips are
 * hover/focus-only and would be unreachable on the exact devices that need
 * them (CLAUDE.md, "Tooltips are hover/focus-only").
 */
export function InstallButton() {
  const { canPrompt, showIosHint, promptInstall } = useInstallPrompt()

  if (canPrompt) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void promptInstall()}
            aria-label="Install Captions Bro as an app"
            className="h-7 w-7 shrink-0"
          >
            <SquarePlus className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Install app</TooltipContent>
      </Tooltip>
    )
  }

  if (!showIosHint) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="How to install Captions Bro as an app"
          className="h-7 w-7 shrink-0"
        >
          <SquarePlus className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <p className="text-sm font-medium text-ink">Install Captions Bro</p>
        <p className="mt-1 text-xs text-muted">
          Full screen, offline, and it keeps your projects. Two taps:
        </p>
        <ol className="mt-2 space-y-1.5 text-xs text-muted">
          <li className="flex items-center gap-1.5">
            <Share className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span>
              Tap <span className="text-ink">Share</span> in Safari&apos;s
              toolbar
            </span>
          </li>
          <li className="flex items-center gap-1.5">
            <SquarePlus className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span>
              Choose <span className="text-ink">Add to Home Screen</span>
            </span>
          </li>
        </ol>
      </PopoverContent>
    </Popover>
  )
}
