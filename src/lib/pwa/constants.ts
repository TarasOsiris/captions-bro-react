// Constants shared between the page and `public/sw.js`.
//
// The service worker is plain, unbundled JS served straight out of `public/`,
// so it cannot import this module — it repeats these literals with a pointer
// back here. If you change one, change both.

export const SW_URL = '/sw.js'

/** POST endpoint declared by the manifest's `share_target`. No server route
 *  stands behind it: the service worker answers it and redirects. */
export const SHARE_TARGET_PATH = '/share-target'

/** Cache the worker parks shared files in, for the page to drain on boot. */
export const SHARE_CACHE = 'cb-share-inbox'
export const SHARE_INBOX_PREFIX = '/__shared-media/'

/** Query flag on the redirect that tells the page an inbox is waiting. */
export const SHARE_FLAG = 'share-target'
