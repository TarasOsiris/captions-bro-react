// An element's content-box size, tracked with a ResizeObserver.
//
// SSR-safe by construction: the observer is created in an effect, so the first
// render always reports 0×0 on both server and client (no hydration mismatch,
// and no media query anywhere near the render path — see CLAUDE.md's
// one-DOM-tree rule).

import { useEffect, useState } from 'react'

export interface ElementSize {
  w: number
  h: number
}

export function useElementSize(
  ref: React.RefObject<HTMLElement | null>,
): ElementSize {
  const [size, setSize] = useState<ElementSize>({ w: 0, h: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
    }
  }, [ref])

  return size
}
