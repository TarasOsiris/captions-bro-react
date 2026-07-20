import { IconExport, IconX } from './icons'

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
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-linear-to-br from-accent to-accent-deep shadow-[0_2px_8px_-2px_rgba(168,137,255,0.5)]">
          <svg
            viewBox="0 0 24 24"
            fill="white"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <path d="M8 5.6v12.8a.8.8 0 0 0 1.23.67l10.05-6.4a.8.8 0 0 0 0-1.35L9.23 4.93A.8.8 0 0 0 8 5.6Z" />
          </svg>
        </div>
        <span className="text-sm font-semibold tracking-tight text-ink">
          Captions Bro
        </span>
      </div>

      <div className="h-4 w-px shrink-0 bg-edge" />

      <span className="min-w-0 flex-1 truncate text-xs text-muted">
        {projectName ?? 'Untitled project'}
      </span>

      {supported === false && (
        <span className="hidden shrink-0 items-center rounded-md border border-[#f5b344]/30 bg-[#f5b344]/10 px-2.5 py-1 text-[11px] text-[#f5c56b] sm:flex">
          H.264 encode unavailable — try Chrome
        </span>
      )}

      {exporting ? (
        <div className="flex w-72 shrink-0 items-center gap-2.5 rounded-lg border border-edge bg-bg px-3 py-1.5">
          <span className="shrink-0 text-[11px] text-muted">
            {exporting.progress >= 0.99 ? 'Finalizing…' : 'Encoding…'}
          </span>
          <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-edge">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out"
              style={{ width: `${Math.max(2, exporting.progress * 100)}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-accent">
            {Math.round(exporting.progress * 100)}%
          </span>
          <button
            type="button"
            onClick={onCancelExport}
            title="Cancel export"
            className="shrink-0 text-muted transition hover:text-ink"
          >
            <IconX className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onExport}
          disabled={!canExport || supported === false}
          className="flex shrink-0 items-center gap-2 rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <IconExport className="h-4 w-4" />
          Export
        </button>
      )}
    </header>
  )
}
