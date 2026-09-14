'use client';

/**
 * Login / Sign-In — matches Stitch crucible_ai_sign_in design exactly.
 * Split layout: left hero (quarry satellite image + "Discover mineral Potential")
 * + right Clerk auth panel ("Welcome back").
 */
import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { SignIn, useAuth } from '@clerk/nextjs';

const FEATURE_PILLS = [
  {
    label: 'Multi-source satellite analysis',
    path: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
    type: 'path',
  },
  {
    label: 'AI-powered target identification',
    cx: '12', cy: '12', r: '9', type: 'circle',
    extra: [
      { x1: '12', x2: '12', y1: '2', y2: '5' },
      { x1: '12', x2: '12', y1: '19', y2: '22' },
    ],
  },
  {
    label: 'Quantified prospectivity mapping',
    path: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    type: 'path',
  },
  {
    label: 'Deposit model classification',
    path: 'M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z',
    type: 'path',
  },
  {
    label: 'Pan-African coverage',
    type: 'globe',
  },
  {
    label: 'GeoTIFF & PDF exports',
    path: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
    type: 'path',
  },
];

export default function LoginPage() {
  const router = useRouter();
  const { isSignedIn } = useAuth();

  useEffect(() => {
    if (isSignedIn) router.replace('/command-center');
  }, [isSignedIn, router]);

  return (
    <main
      className="min-h-screen flex flex-col lg:flex-row antialiased"
      style={{ background: '#0e0b08', color: '#e5e5e5', fontFamily: 'Inter, sans-serif' }}
    >
      {/* ── LEFT: Brand Hero ── */}
      <section
        className="relative w-full lg:w-[55%] min-h-[580px] lg:min-h-screen flex flex-col justify-between overflow-hidden"
        style={{ padding: 'clamp(2rem, 5vw, 5rem)' }}
      >
        {/* Quarry satellite background */}
        <div className="absolute inset-0 z-0">
          <Image
            alt="Aerial view of mineral quarry excavation"
            fill
            priority
            className="object-cover object-center"
            style={{ filter: 'brightness(0.65) contrast(1.15) saturate(0.9)' }}
            src="/images/signup-hero.webp"
          />
          {/* Gradient overlay */}
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle at top left, rgba(14,11,8,0.35), rgba(14,11,8,0.85) 70%, #0e0b08 100%),
                           linear-gradient(to right, rgba(14,11,8,0.2) 0%, rgba(14,11,8,0.92) 100%)`,
            }}
          />
        </div>

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-between h-full" style={{ minHeight: 640 }}>
          {/* Logo */}
          <header className="flex items-center gap-3">
            <Image
              src="/icon.svg"
              alt="Crucible AI Logo"
              width={36}
              height={36}
              className="w-9 h-9 rounded-lg object-contain shadow-lg shadow-[#ea580c]/25"
            />
            <span style={{ fontSize: '1.5rem', fontWeight: 900, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#fff' }}>
              CRUCIBLE <span style={{ color: '#d3996d' }}>AI</span>
            </span>
          </header>

          {/* Headline */}
          <div style={{ margin: 'auto 0', padding: '3rem 0' }}>
            <h1 style={{
              fontFamily: "'Space Grotesk', Inter, sans-serif",
              fontSize: 'clamp(3rem, 8vw, 5.5rem)',
              fontWeight: 900,
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
              lineHeight: 1.05,
              color: '#fff',
              maxWidth: '28rem',
            }}>
              Discover<br />
              <span style={{ color: '#A76332' }}>mineral</span><br />
              Potential
            </h1>
            <p style={{ marginTop: '2rem', color: '#d4d4d4', fontSize: '1rem', maxWidth: '28rem', lineHeight: 1.7, opacity: 0.9 }}>
              Transform satellite imagery and geophysical data into actionable exploration intelligence with AI-powered prospectivity mapping.
            </p>
          </div>

          {/* Feature Pills Grid */}
          <footer style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', paddingTop: '1.5rem', maxWidth: '28rem' }}>
            {FEATURE_PILLS.map((pill) => (
              <div key={pill.label} style={{
                display: 'flex', alignItems: 'center', gap: '0.625rem',
                padding: '0.75rem 1rem',
                borderRadius: '9999px',
                background: 'rgba(21,17,13,0.65)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255,255,255,0.10)',
                color: '#d4d4d4',
                fontSize: '0.8rem',
              }}>
                <svg style={{ width: 16, height: 16, flexShrink: 0, color: '#a3a3a3' }} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  {pill.type === 'path' && <path d={pill.path as string} />}
                  {pill.type === 'circle' && (
                    <>
                      <circle cx="12" cy="12" r="9" />
                      <circle cx="12" cy="12" r="3" />
                      <line x1="12" y1="2" x2="12" y2="5" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                    </>
                  )}
                  {pill.type === 'globe' && (
                    <>
                      <circle cx="12" cy="12" r="9" />
                      <path d="M3.6 9h16.8M3.6 15h16.8M11.5 3a17 17 0 000 18M12.5 3a17 17 0 010 18" />
                    </>
                  )}
                </svg>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pill.label}</span>
              </div>
            ))}
          </footer>
        </div>
      </section>

      {/* ── RIGHT: Auth Panel ── */}
      <section
        className="w-full lg:w-[45%] flex flex-col justify-between z-10"
        style={{
          background: '#0f0c09',
          borderLeft: '1px solid #241c15',
          padding: 'clamp(2rem, 5vw, 5rem)',
        }}
      >
        <div className="hidden lg:block" />

        {/* Form block */}
        <div style={{ maxWidth: 420, width: '100%', margin: 'auto', padding: '2rem 0' }}>
          <header style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '2rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>
              Welcome back
            </h2>
            <p style={{ marginTop: '0.625rem', color: '#a3a3a3', fontSize: '0.875rem' }}>
              Sign in to continue to your dashboard
            </p>
          </header>

          {/* Clerk widget */}
          <SignIn
            fallbackRedirectUrl="/command-center"
            signUpFallbackRedirectUrl="/command-center"
            appearance={{
              elements: {
                rootBox: 'w-full',
                card: 'bg-transparent shadow-none border-none p-0 w-full max-w-full',
                headerTitle: 'hidden',
                headerSubtitle: 'hidden',
                formButtonPrimary: 'normal-case font-semibold text-sm py-3.5',
                formFieldLabel: 'text-xs font-medium text-neutral-300 mb-1.5',
                formFieldInput: 'px-4 py-3 text-sm',
                dividerLine: 'bg-[#231b14]',
                dividerText: 'text-neutral-500 text-xs',
                footerAction: 'hidden',
                identityPreviewText: 'text-white',
                identityPreviewEditButton: 'text-[#A05C2B]',
              },
              variables: {
                colorPrimary: '#9e5a2a',
                colorBackground: '#0a0806',
                colorInputBackground: '#0a0806',
                colorInputText: '#e5e5e5',
                colorText: '#e5e5e5',
                colorTextSecondary: '#a3a3a3',
                borderRadius: '0.375rem',
                colorNeutral: '#a3a3a3',
              },
            } as any}
          />

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '1rem 0' }}>
            <div style={{ flexGrow: 1, borderTop: '1px solid #231b14' }} />
            <span style={{ padding: '0 1rem', color: '#737373', fontSize: '0.75rem' }}>or</span>
            <div style={{ flexGrow: 1, borderTop: '1px solid #231b14' }} />
          </div>

          {/* Guest button */}
          <a
            href="/command-center"
            style={{
              display: 'block', width: '100%', textAlign: 'center',
              padding: '0.75rem 1rem',
              borderRadius: '0.375rem',
              border: '1px solid #2a2016',
              color: '#d4d4d4',
              fontSize: '0.875rem',
              fontWeight: 500,
              textDecoration: 'none',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = '#18130d')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            Continue as Guest
          </a>

          {/* Sign up link */}
          <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.8125rem', color: '#a3a3a3' }}>
            Don&apos;t have an account?{' '}
            <a href="/sign-up" style={{ color: '#E09F67', textDecoration: 'underline', fontWeight: 600 }}>
              Create an account
            </a>
          </div>
        </div>

        {/* Legal footer */}
        <footer style={{
          paddingTop: '2rem',
          borderTop: '1px solid #1e1711',
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
          fontSize: '0.75rem', color: '#737373', gap: '0.75rem',
        }}>
          <nav style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>Terms</a>
            <span>·</span>
            <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>Privacy</a>
            <span>·</span>
            <a href="#" style={{ color: 'inherit', textDecoration: 'none' }}>Cookies</a>
          </nav>
          <div>Developed by <span style={{ color: '#d4d4d4', cursor: 'pointer' }}>Crucible Intelligence</span></div>
        </footer>
      </section>
    </main>
  );
}
