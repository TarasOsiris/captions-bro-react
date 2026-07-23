import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { seo, siteJsonLdScript } from '@/lib/seo'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => {
    // Title, description, robots, Open Graph, Twitter, theme-color + canonical —
    // all server-rendered. See src/lib/seo.ts.
    const { meta, links } = seo()
    return {
      meta: [
        { charSet: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        ...meta,
      ],
      links: [
        // Favicon / app icons — same set as the captions-bro-site marketing site.
        { rel: 'icon', href: '/favicon.ico?v=2', sizes: 'any' },
        {
          rel: 'icon',
          type: 'image/png',
          sizes: '32x32',
          href: '/favicon-32.png?v=2',
        },
        {
          rel: 'apple-touch-icon',
          sizes: '180x180',
          href: '/apple-touch-icon.png?v=2',
        },
        { rel: 'manifest', href: '/site.webmanifest' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        {
          rel: 'preconnect',
          href: 'https://fonts.gstatic.com',
          crossOrigin: 'anonymous',
        },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap',
        },
        { rel: 'stylesheet', href: appCss },
        ...links,
      ],
      // `scripts` are server-rendered into <head> (before <body>). The theme
      // script goes FIRST so it sets the .dark class on <html> before first
      // paint — no flash. Then GA4 (gtag.js) loader + inline init, then the
      // schema.org JSON-LD graph.
      scripts: [
        {
          // Anti-FOUC: reads the user's saved choice, else the OS preference.
          children:
            '(function(){try{' +
            "var s=localStorage.getItem('cb-theme');" +
            "var d=s?s==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;" +
            'var r=document.documentElement;' +
            "r.classList.toggle('dark',d);" +
            "r.style.colorScheme=d?'dark':'light';" +
            '}catch(e){}})();',
        },
        {
          src: 'https://www.googletagmanager.com/gtag/js?id=G-9L6SRQ5WQV',
          async: true,
        },
        {
          children:
            'window.dataLayer = window.dataLayer || [];\n' +
            'function gtag(){dataLayer.push(arguments);}\n' +
            "gtag('js', new Date());\n" +
            "gtag('config', 'G-9L6SRQ5WQV');",
        },
        siteJsonLdScript(),
      ],
    }
  },
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Toaster />
        <TanStackDevtools
          config={{ position: 'bottom-right' }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
