import { useEffect, useLayoutEffect } from 'react'

/**
 * `useLayoutEffect` that doesn't warn during SSR.
 *
 * The route is server-rendered, and React logs a warning for every
 * `useLayoutEffect` on the server (it cannot run there). Anything that must
 * write to the DOM BEFORE paint — restoring a panel width, restoring a scroll
 * offset after a zoom — needs the layout variant on the client, or the default
 * shows for one frame and the user sees a jump.
 */
export const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect
