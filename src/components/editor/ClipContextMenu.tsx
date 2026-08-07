// The clip context menu: the long tail of clip commands, reachable three ways
// (right-click, long-press, and the `⋯` button in the mobile pill) but defined
// ONCE — the items are `useClipCommands`, the same functions the toolbar and
// the keyboard call.
//
// A Radix Popover over a VIRTUAL anchor rather than `@radix-ui/react-context-menu`:
// no new dependency, and `ui/popover.tsx` already documents the hazard this
// needs solved — its outside-press must not reach PreviewStage's frame handler,
// which would deselect the very clip the menu is acting on.
//
// The anchor is a 1×1 `position: fixed` div at the open coordinates. Radix
// positions against a real element, so a menu that should appear "at the
// pointer" needs something there to measure.

import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import type { ClipCommands } from '@/hooks/useClipCommands'

/** Where the menu was opened, in CLIENT coordinates (the anchor is `fixed`, so
 *  a scroll under an open menu doesn't drag it along — the menu is modal enough
 *  that the anchor's job is done the moment it opens). */
export interface MenuAt {
  x: number
  y: number
}

interface Item {
  label: string
  onSelect: () => void
  enabled: boolean
  /** Rendered above a hairline — groups destructive/rare actions at the end. */
  separated?: boolean
}

export function ClipContextMenu({
  at,
  onClose,
  commands,
}: {
  /** Null = closed. */
  at: MenuAt | null
  onClose: () => void
  commands: ClipCommands
}) {
  const items: Item[] = [
    { label: 'Split', onSelect: commands.split, enabled: commands.can.split },
    {
      label: 'Trim start to playhead',
      onSelect: () => {
        commands.trimToPlayhead('left')
      },
      enabled: commands.can.split,
    },
    {
      label: 'Trim end to playhead',
      onSelect: () => {
        commands.trimToPlayhead('right')
      },
      enabled: commands.can.split,
    },
    {
      label: 'Copy',
      onSelect: commands.copy,
      enabled: commands.can.act,
      separated: true,
    },
    { label: 'Cut', onSelect: commands.cut, enabled: commands.can.act },
    { label: 'Paste', onSelect: commands.paste, enabled: commands.can.paste },
    {
      label: 'Duplicate',
      onSelect: commands.duplicate,
      enabled: commands.can.act,
    },
    // Deliberately no "Edit properties": at lg+ the inspector column is always
    // on screen, and below lg the mobile pill carries its own dedicated button
    // right next to the one that opens this menu. Deciding per breakpoint would
    // mean a matchMedia read in a render path, which this codebase forbids.
    {
      label: 'Delete',
      onSelect: commands.remove,
      enabled: commands.can.act,
      separated: true,
    },
  ]

  return (
    <Popover
      open={at != null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {at && (
        <PopoverAnchor asChild>
          <div
            aria-hidden
            className="pointer-events-none fixed h-px w-px"
            style={{
              left: `${at.x.toFixed(0)}px`,
              top: `${at.y.toFixed(0)}px`,
            }}
          />
        </PopoverAnchor>
      )}
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={2}
        className="w-52"
        // The press that OPENED the menu is still in flight on touch (the
        // long-press fires before pointerup), and Radix would otherwise hand
        // focus to the content and immediately dismiss on that same press.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
        }}
      >
        {items.map((item) => (
          <div key={item.label}>
            {item.separated && <div className="my-1 h-px bg-edge" />}
            <button
              type="button"
              disabled={!item.enabled}
              onClick={() => {
                item.onSelect()
                onClose()
              }}
              className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition hover:bg-raised disabled:pointer-events-none disabled:opacity-40"
            >
              {item.label}
            </button>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}
