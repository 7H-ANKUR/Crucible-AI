import type { Metadata, Viewport } from 'next';
import { MinexProviders } from '@/components/minex/Providers';
import { BackendWarmup } from '@/components/minex/BackendWarmup';
import { API_ORIGIN } from '@/lib/api';
import './globals.css';

export const metadata: Metadata = {
  title: 'MINEx — Industrial Mining Intelligence',
  description:
    'Evidence-backed exploration, production and planning decisions for Indian manganese operations.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/** Pre-paint theme init: light is default, `.dark` applied before first render. */
const themeInit = `try{var t=localStorage.getItem('minex_theme');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}`;

/**
 * Pre-hydration backend wake-up.
 *
 * The API sleeps on Render and takes ~90s to cold boot, so the wake request wants to
 * leave the browser at the earliest possible instant. This runs during HTML parse —
 * ahead of React hydration, which on this app means ahead of the Clerk bundle. The
 * full verify-and-retry loop still runs in <BackendWarmup />; this is only the
 * opening shot, so it is deliberately fire-and-forget with no error handling beyond
 * swallowing everything.
 *
 * Skipped for local origins (dev backends do not sleep). The origin is embedded via
 * JSON.stringify so it cannot break out of the string literal.
 */
const warmupInit = `try{var u=${JSON.stringify(API_ORIGIN)};if(u&&!/^https?:\\/\\/(localhost|127\\.0\\.0\\.1|\\[::1\\])/i.test(u)){fetch(u+'/health/live',{mode:'cors',cache:'no-store',credentials:'omit'}).catch(function(){});}}catch(e){}`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {/* DNS + TLS to the API established before the wake request needs it. */}
        {API_ORIGIN ? <link rel="preconnect" href={API_ORIGIN} crossOrigin="anonymous" /> : null}
        <script dangerouslySetInnerHTML={{ __html: warmupInit }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/*
          Fonts are loaded here in the App Router root layout, so they apply to
          every route — the no-page-custom-font rule is a Pages-Router heuristic
          (`pages/_document.js`) and is a false positive here. Kept as <link>
          rather than next/font because the families are referenced through
          Tailwind arbitrary classes (font-['Manrope'], font-['Inter']) in ~27
          files, plus the Material Symbols icon font; next/font would hash the
          family names and require rewriting all of them for no visible gain.
        */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Manrope:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-page text-ink antialiased selection:bg-accent selection:text-onaccent">
        <BackendWarmup />
        <MinexProviders>{children}</MinexProviders>
      </body>
    </html>
  );
}
