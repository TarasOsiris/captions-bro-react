// Hand-drawn 24×24 icon set for the editor chrome. Solid glyphs for transport,
// 1.6px strokes elsewhere — consistent with the hairline UI.

interface IconProps {
  className?: string
}

function StrokeSvg({
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function IconPlay({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 5.6v12.8a.8.8 0 0 0 1.23.67l10.05-6.4a.8.8 0 0 0 0-1.35L9.23 4.93A.8.8 0 0 0 8 5.6Z" />
    </svg>
  )
}

export function IconPause({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <rect x="6.5" y="5" width="4" height="14" rx="1.2" />
      <rect x="13.5" y="5" width="4" height="14" rx="1.2" />
    </svg>
  )
}

export function IconSkipStart({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M6 5a1 1 0 0 1 2 0v14a1 1 0 0 1-2 0z" />
      <path d="M19 6.1v11.8a.8.8 0 0 1-1.26.65l-8.2-5.9a.8.8 0 0 1 0-1.3l8.2-5.9A.8.8 0 0 1 19 6.1Z" />
    </svg>
  )
}

export function IconSkipEnd({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M16 5a1 1 0 0 1 2 0v14a1 1 0 0 1-2 0z" />
      <path d="M5 6.1v11.8a.8.8 0 0 0 1.26.65l8.2-5.9a.8.8 0 0 0 0-1.3l-8.2-5.9A.8.8 0 0 0 5 6.1Z" />
    </svg>
  )
}

export function IconExport({ className }: IconProps) {
  return (
    <StrokeSvg className={className}>
      <path d="M12 15V4" />
      <path d="m7 8 5-4 5 4" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </StrokeSvg>
  )
}

export function IconDownload({ className }: IconProps) {
  return (
    <StrokeSvg className={className}>
      <path d="M12 4v11" />
      <path d="m7 11.5 5 4 5-4" />
      <path d="M5 20h14" />
    </StrokeSvg>
  )
}

export function IconPlus({ className }: IconProps) {
  return (
    <StrokeSvg className={className}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </StrokeSvg>
  )
}

export function IconX({ className }: IconProps) {
  return (
    <StrokeSvg className={className}>
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </StrokeSvg>
  )
}

export function IconCheck({ className }: IconProps) {
  return (
    <StrokeSvg className={className}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </StrokeSvg>
  )
}

export function IconFilm({ className }: IconProps) {
  return (
    <StrokeSvg className={className}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M7.5 5v14" />
      <path d="M16.5 5v14" />
      <path d="M3.5 9.5h4" />
      <path d="M3.5 14.5h4" />
      <path d="M16.5 9.5h4" />
      <path d="M16.5 14.5h4" />
    </StrokeSvg>
  )
}

export function IconType({ className }: IconProps) {
  return (
    <StrokeSvg className={className}>
      <path d="M5 7V5h14v2" />
      <path d="M12 5v14" />
      <path d="M9 19h6" />
    </StrokeSvg>
  )
}

export function IconMusic({ className }: IconProps) {
  return (
    <StrokeSvg className={className}>
      <path d="M9 18.5V6l11-2v12.5" />
      <circle cx="6.5" cy="18.5" r="2.5" />
      <circle cx="17.5" cy="16.5" r="2.5" />
    </StrokeSvg>
  )
}

export function IconCaptions({ className }: IconProps) {
  return (
    <StrokeSvg className={className}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M7 14.5h4.5" />
      <path d="M14 14.5h3" />
      <path d="M7 10.5h3" />
      <path d="M12.5 10.5H17" />
    </StrokeSvg>
  )
}

export function IconChevronLeft({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m14.5 6-6 6 6 6" />
    </svg>
  )
}

export function IconChevronRight({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m9.5 6 6 6-6 6" />
    </svg>
  )
}

export function IconScissors({ className }: IconProps) {
  return (
    <StrokeSvg className={className}>
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <path d="M8.6 8.3 20 19" />
      <path d="M20 5 8.6 15.7" />
    </StrokeSvg>
  )
}

export function IconCopy({ className }: IconProps) {
  return (
    <StrokeSvg className={className}>
      <path d="M15 4H6a2 2 0 0 0-2 2v9" />
      <rect x="9" y="9" width="11" height="11" rx="2" />
    </StrokeSvg>
  )
}

export function IconTrash({ className }: IconProps) {
  return (
    <StrokeSvg className={className}>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="m6.5 7 .8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12" />
    </StrokeSvg>
  )
}
