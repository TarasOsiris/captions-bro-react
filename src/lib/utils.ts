import { clsx } from 'clsx'
import type { ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge conditional class names, de-duping conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Re-exported so existing `import { clamp } from '@/lib/utils'` call sites keep
// working; the definition lives in the dependency-free `math` module.
export { clamp } from './math'
