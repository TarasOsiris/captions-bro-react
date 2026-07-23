import { Toaster as Sonner } from 'sonner'
import type { ToasterProps } from 'sonner'
import { useTheme } from '@/hooks/useTheme'

/** App toaster, themed to the editor's surfaces and offset above the
 *  288px (h-72) timeline so toasts never sit under it. */
function Toaster(props: ToasterProps) {
  const { theme } = useTheme()
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      offset={{ bottom: '19rem', right: '1rem' }}
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
