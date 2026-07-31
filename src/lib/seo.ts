// SEO helpers for the server-rendered <head> in `src/routes/__root.tsx`.
//
// Ported from the sibling marketing site (`captions-bro-site/src/lib/seo.ts`),
// but adapted for TanStack Start: instead of a runtime `useSeo` hook that mutates
// the DOM after hydration, this returns plain `{ meta, links }` arrays for
// TanStack's `head()` so every tag ships in the SSR HTML on first paint (which is
// what crawlers and social scrapers read).

import { THEME_COLOR } from '@/lib/theme'

export const siteUrl = 'https://editor.captionsbro.app'
export const siteName = 'Captions Bro'
export const appIconImage = `${siteUrl}/app-icon-512.png`
export const defaultSeoImage = `${siteUrl}/og-image.png`

export const defaultTitle =
  'Free Browser Video Editor (No Account, No Watermark) — Captions Bro'
export const defaultDescription =
  '100% free browser video editor with no account, no registration, and no watermark. Trim video clips, add captions and text, and export clean MP4s directly in your web browser with zero uploads.'

const defaultImageAlt =
  'Free browser video editor — no watermark, no account, no registration — Captions Bro'

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
    {
      name: 'keywords',
      content:
        'free browser video editor, video editor no account, video editor no registration, video editor no watermark, free online video editor, in-browser video editing, private video editor, client-side video editor, add captions to video',
    },
    { name: 'application-name', content: siteName },
    { name: 'apple-mobile-web-app-title', content: siteName },
    { name: 'author', content: siteName },
    { name: 'robots', content: robots },
    // SSR default (dark --surface, matching the manifest's theme_color); the
    // theme module rewrites this to the light value on mount/toggle when the
    // applied theme is light. Imported, never re-typed — see lib/theme.ts.
    { name: 'theme-color', content: THEME_COLOR.dark },
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
// A single `@graph` of Organization + WebSite + WebApplication + FAQPage,
// describing the browser product and key features.

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
      'free browser video editor',
      'in-browser video editing',
      'video editor with no watermark',
      'video editing without an account',
      'video editor no registration',
      'add captions and subtitles to video',
      'WebCodecs video export',
      'client-side video editing',
      'short-form video',
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
    name: `${siteName} — Free Browser Video Editor`,
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
    // Free-forever, no paywall, no login — an honest, machine-readable signal
    // that reinforces the title/description differentiators.
    isAccessibleForFree: true,
    featureList: [
      'Free browser video editor — 100% free to use',
      'No account or sign-up / registration required',
      'No watermark on exported MP4 videos',
      'Runs entirely in your web browser',
      'Trim, arrange, and combine video and image clips',
      'Add styled captions, subtitles, and text overlays',
      'Client-side H.264 + AAC MP4 export — no upload, nothing leaves your device',
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

export function faqJsonLd() {
  return {
    '@type': 'FAQPage',
    '@id': `${siteUrl}/#faq`,
    mainEntity: [
      {
        '@type': 'Question',
        name: 'Is Captions Bro a free browser video editor?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes! Captions Bro is a 100% free in-browser video editor. You can trim clips, format captions, and export HD videos with zero cost.',
        },
      },
      {
        '@type': 'Question',
        name: 'Do I need an account or registration to use this video editor?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'No. Captions Bro requires no account, no login, and no registration. Simply open the app in your browser and start editing immediately.',
        },
      },
      {
        '@type': 'Question',
        name: 'Does Captions Bro place a watermark on exported videos?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'No! Exported videos carry no watermarks. Your final exported MP4 video is completely clean.',
        },
      },
      {
        '@type': 'Question',
        name: 'Are my videos uploaded to any server or cloud?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'No. Video rendering and encoding take place 100% client-side inside your web browser using WebCodecs technology. Your media files never leave your device.',
        },
      },
    ],
  }
}

/**
 * The `<script type="application/ld+json">` entry for `head().scripts` — the
 * combined Organization + WebSite + WebApplication + FAQPage graph.
 */
export function siteJsonLdScript() {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      organizationJsonLd(),
      websiteJsonLd(),
      webApplicationJsonLd(),
      faqJsonLd(),
    ],
  }
  return {
    type: 'application/ld+json',
    children: JSON.stringify(graph),
  }
}
