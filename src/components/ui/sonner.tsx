import { Toaster as Sonner } from 'sonner'
import type { ToasterProps } from 'sonner'

/** App toaster, themed to the editor's dark surfaces and offset above the
 *  224px (h-56) timeline so toasts never sit under it. */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      offset={{ bottom: '15rem', right: '1rem' }}
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
