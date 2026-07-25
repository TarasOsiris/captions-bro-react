import { Toaster as Sonner } from 'sonner'
import type { ToasterProps } from 'sonner'
import { useTheme } from '@/hooks/useTheme'

/** App toaster, themed to the editor's surfaces and lifted clear of the bottom
 *  chrome so toasts never sit under it. The offset comes from
 *  `--toast-offset-bottom` in styles.css (timeline height + mobile rail + safe
 *  area) — never hardcode a number here, or it silently drifts out of sync with
 *  the timeline the way the old literal `19rem` did. */
function Toaster(props: ToasterProps) {
  const { theme } = useTheme()
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      offset={{ bottom: 'var(--toast-offset-bottom)', right: '1rem' }}
      mobileOffset={{
        bottom: 'var(--toast-offset-bottom)',
        left: '1rem',
        right: '1rem',
      }}
      toastOptions={{
        classNames: {
          toast:
            'group !rounded-xl !border-edge !bg-surface !text-ink !shadow-2xl',
          title: '!text-sm !text-ink',
          description: '!text-xs !text-muted',
          actionButton:
            '!rounded-md !bg-accent !px-2 !py-1 !text-xs !font-medium !text-white',
          cancelButton:
            '!rounded-md !bg-raised !px-2 !py-1 !text-xs !text-muted',
          error: '!border-[#ff7a7a]/30',
          success: '[&_[data-icon]]:!text-accent',
          warning: '!border-[#f5b344]/30 [&_[data-icon]]:!text-[#f5c56b]',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
