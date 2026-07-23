// SEO helpers for the server-rendered <head> in `src/routes/__root.tsx`.
//
// Ported from the sibling marketing site (`captions-bro-site/src/lib/seo.ts`),
// but adapted for TanStack Start: instead of a runtime `useSeo` hook that mutates
// the DOM after hydration, this returns plain `{ meta, links }` arrays for
// TanStack's `head()` so every tag ships in the SSR HTML on first paint (which is
// what crawlers and social scrapers read).

export const siteUrl = 'https://editor.captionsbro.app'
export const siteName = 'Captions Bro'
export const appIconImage = `${siteUrl}/app-icon-512.png`
export const defaultSeoImage = `${siteUrl}/og-image.png`

export const defaultTitle = 'Captions Bro — Video Captions in Your Browser'
export const defaultDescription =
  'Cut clips, generate accurate AI captions, animate subtitles, and export social videos right in your browser with Captions Bro — no upload, no install, and nothing leaves your device.'

const defaultImageAlt = 'Captions Bro — browser video editor with auto captions'

// The host serves page URLs with a trailing slash (200) and 301-redirects the
// slashless form, so canonical / og:url / JSON-LD URLs must carry the slash to
// avoid pointing at a redirect. Asset files (with an extension) are left as-is.
function withTrailingSlash(path: string) {
  if (path.endsWith('/')) return path
  const lastSegment = path.split('/').pop() ?? ''
  if (lastSegment.includes('.')) return path
  return `${path}/`
}

export function absoluteUrl(path = '/') {
  if (path.startsWith('http')) return path
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${siteUrl}${withTrailingSlash(normalized)}`
}

function imageType(url: string) {
  if (url.endsWith('.svg')) return 'image/svg+xml'
  if (url.endsWith('.png')) return 'image/png'
  if (url.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

type SeoOptions = {
  title?: string
  description?: string
  path?: string
  image?: string
  imageAlt?: string
  type?: 'website' | 'article'
  robots?: string
}

/**
 * Build the `meta` + `links` arrays for a route's `head()`. Called with no
 * arguments it returns the site-wide defaults (the single `/` route); the
 * options let future routes override title/description/canonical/image.
 */
export function seo({
  title = defaultTitle,
  description = defaultDescription,
  path = '/',
  image = defaultSeoImage,
  imageAlt = defaultImageAlt,
  type = 'website',
  robots = 'index,follow,max-image-preview:large',
}: SeoOptions = {}) {
  const url = absoluteUrl(path)
  const imageUrl = image.startsWith('http') ? image : absoluteUrl(image)

  const meta = [
    { title },
    { name: 'description', content: description },
    { name: 'application-name', content: siteName },
    { name: 'apple-mobile-web-app-title', content: siteName },
    { name: 'author', content: siteName },
    { name: 'robots', content: robots },
    // SSR default (matches dark --bg); the theme module rewrites this to the
    // light value on mount/toggle when the applied theme is light.
    { name: 'theme-color', content: '#0b0d10' },
    // Open Graph
    { property: 'og:site_name', content: siteName },
    { property: 'og:type', content: type },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:url', content: url },
    { property: 'og:image', content: imageUrl },
    { property: 'og:image:alt', content: imageAlt },
    { property: 'og:image:type', content: imageType(imageUrl) },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:locale', content: 'en_US' },
    // Twitter / X
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: imageUrl },
    { name: 'twitter:image:alt', content: imageAlt },
  ]

  const links = [{ rel: 'canonical', href: url }]

  return { meta, links }
}

// --- JSON-LD (schema.org) -------------------------------------------------
// A single `@graph` of Organization + WebSite + WebApplication, mirroring the
// marketing site's structured data but describing the *browser* product.

export function organizationJsonLd() {
  return {
    '@type': 'Organization',
    '@id': `${siteUrl}/#organization`,
    name: siteName,
    url: absoluteUrl('/'),
    description: defaultDescription,
    logo: {
      '@type': 'ImageObject',
      url: appIconImage,
    },
    knowsAbout: [
      'video captions',
      'AI subtitles',
      'in-browser video editing',
      'WebCodecs video export',
      'short-form video',
      'video captioning for creators',
    ],
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Berlin',
      addressCountry: 'DE',
    },
    parentOrganization: {
      '@type': 'Organization',
      name: 'Nineva Studios',
    },
    contactPoint: {
      '@type': 'ContactPoint',
      email: 'info@ninevastudios.com',
      contactType: 'customer support',
    },
    sameAs: [
      'https://captionsbro.app/',
      'https://x.com/soycastic',
      'https://www.threads.com/@soycastic',
      'https://www.reddit.com/r/captionsbro/',
    ],
  }
}

export function websiteJsonLd() {
  return {
    '@type': 'WebSite',
    '@id': `${siteUrl}/#website`,
    name: siteName,
    url: absoluteUrl('/'),
    description: defaultDescription,
    inLanguage: 'en-US',
    publisher: { '@id': `${siteUrl}/#organization` },
  }
}

export function webApplicationJsonLd() {
  return {
    '@type': 'WebApplication',
    '@id': `${siteUrl}/#webapp`,
    name: siteName,
    url: absoluteUrl('/'),
    description: defaultDescription,
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Any',
    browserRequirements:
      'Requires a modern browser with WebCodecs support (Chrome, Edge, or Safari 26+)',
    image: defaultSeoImage,
    inLanguage: 'en-US',
    isPartOf: { '@id': `${siteUrl}/#website` },
    publisher: { '@id': `${siteUrl}/#organization` },
    featureList: [
      'Import video and image clips',
      'AI-generated captions and animated subtitles',
      'WYSIWYG 16:9 preview',
      'Client-side H.264 + AAC MP4 export (no upload)',
    ],
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    sameAs: [
      'https://apps.apple.com/us/app/edits-video-editor/id6738967378',
      'https://captionsbro.app/',
    ],
  }
}

/**
 * The `<script type="application/ld+json">` entry for `head().scripts` — the
 * combined Organization + WebSite + WebApplication graph.
 */
export function siteJsonLdScript() {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [organizationJsonLd(), websiteJsonLd(), webApplicationJsonLd()],
  }
  return {
    type: 'application/ld+json',
    children: JSON.stringify(graph),
  }
}
