'use client';

/**
 * Sign-Up — matches Stitch crucible_ai_sign_up design exactly.
 * Split layout: left hero (geological engineers site image + "Start your exploration Journey")
 * + right Clerk auth panel ("Create your account").
 */
import React, { useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { SignUp, useAuth } from '@clerk/nextjs';

export default function SignUpPage() {
  const router = useRouter();
  const { isSignedIn } = useAuth();

  useEffect(() => {
    if (isSignedIn) router.replace('/command-center');
  }, [isSignedIn, router]);

  return (
    <main
      className="min-h-screen flex flex-col lg:flex-row antialiased bg-[#F7EFE6] text-slate-800 selection:bg-[#8E4D25] selection:text-white"
      style={{ fontFamily: 'Inter, sans-serif' }}
    >
      {/* ── LEFT: Brand Hero ── */}
      <section className="relative w-full lg:w-[55%] min-h-[580px] lg:min-h-screen flex flex-col justify-between p-8 sm:p-12 lg:p-16 overflow-hidden bg-[#130C07]">
        {/* Background Quarry Image */}
        <div className="absolute inset-0 z-0">
          <Image
            alt="Geological engineers inspecting mining site"
            fill
            priority
            className="object-cover object-center opacity-55 transform scale-105 filter saturate-85 contrast-125"
            src="/images/signup-hero.webp"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/60 to-black/30" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-transparent to-black/40" />
        </div>

        {/* Top Header / Brand Logo */}
        <header className="relative z-10">
          <div className="flex items-center space-x-3.5 tracking-wider">
            <Image
              src="/icon.svg"
              alt="Crucible AI Logo"
              width={36}
              height={36}
              className="w-9 h-9 rounded-lg object-contain shadow-lg shadow-[#ea580c]/25"
            />
            <span className="text-2xl font-black tracking-[0.25em] text-white uppercase font-sans">
              CRUCIBLE <span className="text-[#E09F67]">AI</span>
            </span>
          </div>
        </header>

        {/* Center Content: Title & Bullet Points */}
        <div className="relative z-10 my-auto py-10 lg:py-16 max-w-xl">
          <h1 className="text-4xl sm:text-5xl lg:text-[3.75rem] text-white mb-10 font-black tracking-tight leading-[1.05]">
            Start your <br />
            <span className="text-[#E09F67]">exploration</span> <br />
            Journey
          </h1>

          {/* Feature Points */}
          <div className="space-y-6 max-w-md">
            {/* Feature 1 */}
            <div className="flex items-start space-x-4 group">
              <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0 text-white/80 group-hover:text-[#E09F67] group-hover:border-[#E09F67]/40 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-semibold text-base">Fast Analysis</h3>
                <p className="text-white/60 text-sm mt-0.5">Results in hours, not weeks</p>
              </div>
            </div>

            {/* Feature 2 */}
            <div className="flex items-start space-x-4 group">
              <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0 text-white/80 group-hover:text-[#E09F67] group-hover:border-[#E09F67]/40 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                  <path d="M3.6 9h16.8M3.6 15h16.8" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                  <path d="M12 3a14.3 14.3 0 00-3.5 9 14.3 14.3 0 003.5 9 14.3 14.3 0 003.5-9A14.3 14.3 0 0012 3z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-semibold text-base">Pan-African &amp; Global Coverage</h3>
                <p className="text-white/60 text-sm mt-0.5">Sentinel-2, ASTER, EMIT data</p>
              </div>
            </div>

            {/* Feature 3 */}
            <div className="flex items-start space-x-4 group">
              <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0 text-white/80 group-hover:text-[#E09F67] group-hover:border-[#E09F67]/40 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-semibold text-base">Peer-Reviewed Methods</h3>
                <p className="text-white/60 text-sm mt-0.5">Published spectral indices</p>
              </div>
            </div>
          </div>
        </div>

        {/* Left Footer Tagline */}
        <footer className="relative z-10 pt-6 border-t border-white/10">
          <p className="text-white/50 text-sm font-medium">
            Trusted by exploration teams across Africa and Latin America
          </p>
        </footer>
      </section>

      {/* ── RIGHT: Clerk SignUp Container ── */}
      <section className="w-full lg:w-[45%] bg-[#F7EFE6] flex flex-col justify-between p-8 sm:p-12 lg:px-20 lg:py-16">
        <div className="hidden lg:block" />

        <div className="w-full max-w-md mx-auto my-auto py-8">
          <header className="mb-6">
            <h2 className="text-3xl sm:text-4xl text-neutral-900 font-extrabold tracking-tight leading-tight">
              Create your account
            </h2>
            <p className="text-neutral-600 text-sm sm:text-base mt-2 leading-relaxed">
              Get started with mineral prospectivity analysis and autonomous pit intelligence
            </p>
          </header>

          <SignUp
            path="/sign-up"
            routing="path"
            signInUrl="/sign-in"
            fallbackRedirectUrl="/command-center"
            appearance={{
              elements: {
                rootBox: 'w-full',
                card: 'bg-transparent shadow-none p-0 border-0 w-full',
                header: 'hidden',
                footer: 'hidden',
                formButtonPrimary:
                  'w-full py-3.5 px-6 rounded-lg bg-[#8E4D25] hover:bg-[#783F1D] text-white font-semibold text-base shadow-sm hover:shadow transition-all duration-150 active:scale-[0.99] border-0',
                formFieldInput:
                  'w-full px-4 py-3.5 bg-white border border-stone-300 rounded-lg text-neutral-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-[#8E4D25] focus:border-[#8E4D25] shadow-sm text-sm',
                formFieldLabel:
                  'block text-xs font-semibold text-neutral-800 uppercase tracking-wider mb-2',
                socialButtonsBlockButton:
                  'w-full py-3 px-4 border border-stone-300 rounded-lg bg-white text-neutral-800 hover:bg-stone-50 font-medium text-sm transition-colors shadow-sm',
                dividerRow: 'my-6',
                dividerText: 'text-xs text-neutral-500 uppercase tracking-wider',
                identityPreviewText: 'text-sm text-neutral-700',
                identityPreviewEditButton: 'text-xs text-[#8E4D25] font-semibold hover:underline',
              },
            }}
          />

          <div className="text-center pt-6 border-t border-stone-300/60 mt-6">
            <p className="text-sm text-neutral-600">
              Already have an account?{' '}
              <Link href="/sign-in" className="font-semibold text-[#8E4D25] hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </div>

        <div className="text-center lg:text-left text-xs text-neutral-500 pt-6">
          &copy; {new Date().getFullYear()} Crucible AI. All rights reserved.
        </div>
      </section>
    </main>
  );
}
