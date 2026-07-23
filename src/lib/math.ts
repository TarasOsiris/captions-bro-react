// Tiny pure numeric helpers. No DOM / UI deps, so the SSR-safe model layer can
// import these without pulling in clsx/tailwind-merge (which `utils.ts` carries).

/** Clamp `value` into the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
