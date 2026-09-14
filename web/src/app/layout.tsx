import type { Metadata, Viewport } from 'next';
import { CrucibleProviders } from '@/components/crucible/Providers';
import { BackendWarmup } from '@/components/crucible/BackendWarmup';
import { API_ORIGIN } from '@/lib/api';
import './globals.css';

export const metadata: Metadata = {
  title: 'Crucible AI — Industrial Mining Intelligence',
  description:
    'Evidence-backed exploration, production and planning decisions for Indian manganese operations.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

// Light-only theme: no dark mode init script needed.

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
const warmupInit = `try{var u=${JSON.stringify(API_ORIGIN)};if(u&&!/^https?:\\/\\/(localhost|127\\.0\\.0\\.1|\\[::1\\])/i.test(u)){fetch(u+'/ping',{mode:'cors',cache:'no-store',credentials:'omit'}).catch(function(){});}}catch(e){}`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
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
          Tailwind arbitrary classes (font-['Space_Grotesk'], font-['Inter']) in ~27
          files, plus the Material Symbols icon font; next/font would hash the
          family names and require rewriting all of them for no visible gain.
        */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Work+Sans:wght@400;500;600&family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-canvas-sandstone text-on-surface antialiased selection:bg-primary-fixed selection:text-on-primary-fixed">
        <BackendWarmup />
        <CrucibleProviders>{children}</CrucibleProviders>
      </body>
    </html>
  );
}
