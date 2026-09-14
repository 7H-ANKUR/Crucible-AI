'use client';

/**
 * Landing Page — Crucible AI Autonomous Mineral Intelligence & Telemetry
 * 100% faithful implementation of Stitch reference: crucible_ai_landing_page/code.html
 *
 * Sections:
 *   1. MainHeader (Logo, Navigation, Sign In / Register CTAs)
 *   2. HeroSection (Aerial Quarry Excavation, Eyebrow, Typography, 5-Stat Ribbon)
 *   3. CoreCapabilitiesSection (3 Glass Bento Cards: Hyperspectral, Target Conviction, Haul Telemetry)
 *   4. VisualTelemetrySpotlight (Autonomous Mining Engine, Telemetry Checklist, Pit Bench Imagery)
 *   5. SocialProofSection (Industry Leader Badges)
 *   6. CallToActionSection (Audit Form & Enterprise Credentials)
 *   7. MainFooter (Directory Links, Certifications, Copyright)
 */

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

export default function LandingPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  function handleAuditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (email) {
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 4000);
    }
  }

  return (
    <div className="bg-[#14110f] text-[#fff8f4] font-sans overflow-x-hidden selection:bg-[#9e5a2a] selection:text-white min-h-screen">
      
      {/* ── 1. Main Header ──────────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 transition-all duration-300">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          {/* Brand Logo */}
          <Link aria-label="Crucible AI Home" className="flex items-center gap-3 group" href="/">
            <Image
              src="/icon.svg"
              alt="Crucible AI Logo"
              width={36}
              height={36}
              className="w-9 h-9 rounded-lg shadow-lg shadow-[#ea580c]/25 group-hover:scale-105 transition-transform duration-300 object-contain"
              priority
            />
            <div className="flex flex-col">
              <span className="font-['Space_Grotesk'] font-extrabold text-xl tracking-wider text-white">
                CRUCIBLE<span className="text-[#d3996d]">AI</span>
              </span>
              <span className="text-[9px] uppercase tracking-[0.25em] text-stone-400 font-medium -mt-1">
                Mineral Intelligence
              </span>
            </div>
          </Link>

          {/* Desktop Navigation Menu */}
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-stone-300">
            <a className="hover:text-[#d3996d] transition-colors duration-200" href="#capabilities">
              How It Works
            </a>
            <a className="hover:text-[#d3996d] transition-colors duration-200" href="#capabilities">
              Capabilities
            </a>
            <a className="hover:text-[#d3996d] transition-colors duration-200" href="#telemetry">
              Solutions
            </a>
            <a className="hover:text-[#d3996d] transition-colors duration-200" href="#proof">
              About
            </a>
            <Link className="hover:text-[#d3996d] transition-colors duration-200" href="/command-center">
              Command Center
            </Link>
          </nav>

          {/* Action Buttons */}
          <div className="flex items-center gap-4">
            <Link
              className="text-sm font-medium text-stone-300 hover:text-white px-5 py-2 rounded-full border border-stone-700/60 hover:border-[#d3996d]/60 transition-all duration-200"
              href="/sign-in"
            >
              Sign In
            </Link>
          </div>
        </div>
      </header>

      {/* ── 2. Hero Section ─────────────────────────────────────────────── */}
      <section className="relative min-h-screen pt-28 pb-16 flex flex-col justify-between overflow-hidden" data-purpose="hero-viewport">
        {/* Background Imagery & Aerial Excavation */}
        <div className="absolute inset-0 z-0 select-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt="Open pit mine excavation aerial top-down view"
            className="w-full h-full object-cover object-center scale-105 filter brightness-75 contrast-110"
            src="/images/homepage-hero.webp"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src =
                'https://lh3.googleusercontent.com/aida-public/AB6AXuBPLpanTyQQEYJ_fOzzP0zCb2HNKlcUnHgorlKtbymOwA_5H7oSJsx_SetKQmBjhlz-ULSVsqOGOZIAIpFgkxCEmcsHrX7jqDsLn05IyaIL_tvm_3uQYSWJM-uAhIlxTgKEbGfPfaOMI0p24vT2PVJm3uWg4mo3wAyo9EIzuZ7dcgYUuj4EfJVxbxpBTxNtyTwxc0m8aa5l1_2MMC4vpoX7QimKPYnJkuKjfSDsfTEIFRN2tPamoXcenj6PkcES-BxUZg';
            }}
          />
          {/* Dark scrim for text legibility */}
          <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/40 to-black/20 pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/50 pointer-events-none" />
        </div>

        {/* Main Hero Text Content */}
        <div className="relative z-10 max-w-7xl mx-auto px-6 pt-16 lg:pt-24 w-full flex-grow flex flex-col justify-center">
          {/* Eyebrow Pill Badge */}
          <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-[#2c2520]/75 backdrop-blur-md border border-[#d3996d]/30 w-fit mb-8 shadow-lg">
            <span className="w-4 h-4 rounded-full flex items-center justify-center text-[#d3996d]">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" x2="22" y1="12" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </span>
            <span className="text-xs font-medium text-stone-200 tracking-wide">
              AI-powered mineral exploration across India
            </span>
          </div>

          {/* Hero Heading */}
          <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-[5.3rem] font-extrabold text-white tracking-tight leading-[1.08] max-w-4xl font-['Space_Grotesk'] drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
            Discover high-value <span className="text-[#d3996d] block sm:inline">mineral targets</span>
          </h1>

          {/* Description Subheading */}
          <p className="mt-7 text-base md:text-lg lg:text-xl text-stone-200 font-normal leading-relaxed max-w-2xl font-sans drop-shadow-[0_1px_6px_rgba(0,0,0,0.5)]">
            <strong className="text-white font-semibold">Crucible AI</strong> is an AI-powered mineral prospectivity mapping & operational telemetry platform for India. We transform hyperspectral satellite imagery, geophysical records, and machine learning into ranked exploration targets for gold, copper, lithium, and battery metals — delivered in hours, not months.
          </p>

          {/* Primary CTAs */}
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              className="inline-flex items-center gap-2.5 bg-[#9e5a2a] hover:bg-[#b56832] text-white text-base font-medium px-8 py-3.5 rounded-full shadow-lg shadow-[#9e5a2a]/40 hover:shadow-[#9e5a2a]/60 transition-all duration-300 transform hover:-translate-y-0.5"
              href="/command-center"
            >
              <span>Explore Command Center</span>
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M14 5l7 7m0 0l-7 7m7-7H3" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
              </svg>
            </Link>
            <a
              className="inline-flex items-center justify-center px-8 py-3.5 rounded-full bg-[#2c2520]/65 backdrop-blur-md border border-[#d3996d]/25 hover:bg-stone-800/80 text-stone-200 hover:text-white text-base font-medium transition-all duration-200"
              href="#capabilities"
            >
              View Capabilities
            </a>
          </div>
        </div>

        {/* Bottom Telemetry & Stats Ribbon */}
        <div className="relative z-10 max-w-7xl mx-auto px-6 w-full pt-16 pb-8">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-6 sm:gap-8 pt-8 border-t border-white/20">
            <div>
              <div className="text-3xl sm:text-4xl font-extrabold text-white font-['Space_Grotesk'] tracking-tight">20m</div>
              <p className="text-xs sm:text-sm text-stone-400 mt-1 font-medium">Native spatial resolution</p>
            </div>
            <div>
              <div className="text-3xl sm:text-4xl font-extrabold text-white font-['Space_Grotesk'] tracking-tight">285</div>
              <p className="text-xs sm:text-sm text-stone-400 mt-1 font-medium">Spectral bands analyzed</p>
            </div>
            <div>
              <div className="text-3xl sm:text-4xl font-extrabold text-white font-['Space_Grotesk'] tracking-tight">up to 7</div>
              <p className="text-xs sm:text-sm text-stone-400 mt-1 font-medium">Deposit models per run</p>
            </div>
            <div>
              <div className="text-3xl sm:text-4xl font-extrabold text-white font-['Space_Grotesk'] tracking-tight">6+</div>
              <p className="text-xs sm:text-sm text-stone-400 mt-1 font-medium">Global satellite data sources</p>
            </div>
            <div className="hidden lg:block">
              <div className="text-3xl sm:text-4xl font-extrabold text-white font-['Space_Grotesk'] tracking-tight">99.2%</div>
              <p className="text-xs sm:text-sm text-stone-400 mt-1 font-medium">Telemetry model fidelity</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. Core Capabilities Section ────────────────────────────────── */}
      <section className="relative py-24 bg-[#1a1613] border-t border-[#2c2520]/50" id="capabilities">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-3xl mb-16">
            <span className="text-xs uppercase tracking-widest text-[#d3996d] font-semibold block mb-3 font-['Space_Grotesk']">
              Enterprise Hyperspectral Engine
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white font-['Space_Grotesk'] leading-tight">
              Next-generation prospectivity mapping from orbit to drill core
            </h2>
            <p className="mt-4 text-stone-400 text-base sm:text-lg leading-relaxed">
              Crucible AI fuses high-resolution hyperspectral satellites, regional gravity and magnetic datasets, and deep learning prospectivity algorithms to reduce greenfield exploration risk by over 65%.
            </p>
          </div>

          {/* Interactive 3-Column Features Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Card 1 */}
            <div className="bg-gradient-to-b from-[#1e1915]/85 to-[#14110f]/95 border border-[#9e5a2a]/25 hover:border-[#d98246]/45 rounded-2xl p-8 flex flex-col justify-between shadow-2xl transition-all duration-300">
              <div>
                <div className="w-12 h-12 rounded-xl bg-[#9e5a2a]/20 border border-[#9e5a2a]/40 flex items-center justify-center text-[#d3996d] mb-6">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-white mb-3 font-['Space_Grotesk']">Hyperspectral Mineral Mapping</h3>
                <p className="text-sm text-stone-400 leading-relaxed">
                  Detect surface alteration halos (alunite, kaolinite, muscovite, gossans) using PRISMA, EnMAP, and WorldView-3 SWIR calibrated band combinations.
                </p>
              </div>
              <div className="mt-8 pt-6 border-t border-stone-800 text-xs text-[#d3996d] flex items-center gap-2 font-medium">
                <span>285-Channel Radiometric Tuning</span>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                </svg>
              </div>
            </div>

            {/* Card 2 */}
            <div className="bg-gradient-to-b from-[#1e1915]/85 to-[#14110f]/95 border border-[#9e5a2a]/25 hover:border-[#d98246]/45 rounded-2xl p-8 flex flex-col justify-between shadow-2xl transition-all duration-300">
              <div>
                <div className="w-12 h-12 rounded-xl bg-[#9e5a2a]/20 border border-[#9e5a2a]/40 flex items-center justify-center text-[#d3996d] mb-6">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M13 10V3L4 14h7v7l9-11h-7z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-white mb-3 font-['Space_Grotesk']">Target Conviction Ranking</h3>
                <p className="text-sm text-stone-400 leading-relaxed">
                  Ensemble machine learning models cross-correlate geological faults, radiometric shears, and verified deposit lithologies to score target probability.
                </p>
              </div>
              <div className="mt-8 pt-6 border-t border-stone-800 text-xs text-[#d3996d] flex items-center gap-2 font-medium">
                <span>Automated GIS Drill Vector Export</span>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                </svg>
              </div>
            </div>

            {/* Card 3 */}
            <div className="bg-gradient-to-b from-[#1e1915]/85 to-[#14110f]/95 border border-[#9e5a2a]/25 hover:border-[#d98246]/45 rounded-2xl p-8 flex flex-col justify-between shadow-2xl transition-all duration-300">
              <div>
                <div className="w-12 h-12 rounded-xl bg-[#9e5a2a]/20 border border-[#9e5a2a]/40 flex items-center justify-center text-[#d3996d] mb-6">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-white mb-3 font-['Space_Grotesk']">Operations & Haul Telemetry</h3>
                <p className="text-sm text-stone-400 leading-relaxed">
                  Seamlessly transition from exploration discovery to autonomous pit dispatch, payload grade tracking, and real-time excavator dig-rate intelligence.
                </p>
              </div>
              <div className="mt-8 pt-6 border-t border-stone-800 text-xs text-[#d3996d] flex items-center gap-2 font-medium">
                <span>Fleet ISO-13849 Compliance</span>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 4. Visual Telemetry Spotlight ───────────────────────────────── */}
      <section className="relative py-24 bg-[#14110f] overflow-hidden" id="telemetry">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Left Side: Copy and Operational Targets */}
            <div className="lg:col-span-6 space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#9e5a2a]/20 text-[#d3996d] text-xs font-semibold uppercase tracking-wider font-['Space_Grotesk']">
                Autonomous Mining Engine
              </div>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white font-['Space_Grotesk'] tracking-tight leading-tight">
                From regional prospectivity to daily pit-floor optimization
              </h2>
              <p className="text-stone-300 text-base leading-relaxed">
                Crucible AI bridges geoscience modeling and pit excavation. Integrate real-time haul truck telemetry, drill-and-blast rock fragmentation computer vision, and grade boundary updates straight into your mine dispatch systems.
              </p>

              {/* Metric Highlights Checklist */}
              <div className="space-y-4 pt-2">
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-[#d3996d]/20 text-[#d3996d] flex items-center justify-center mt-1 flex-shrink-0">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
                    </svg>
                  </div>
                  <div>
                    <strong className="text-white text-sm font-semibold">Pre-trained Deposit Models:</strong>
                    <span className="text-stone-400 text-sm"> Porphyry Cu-Au, Orogenic Gold, LCT Pegmatites (Lithium), and Iron Oxide Copper-Gold (IOCG).</span>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-[#d3996d]/20 text-[#d3996d] flex items-center justify-center mt-1 flex-shrink-0">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
                    </svg>
                  </div>
                  <div>
                    <strong className="text-white text-sm font-semibold">Sub-surface Integration:</strong>
                    <span className="text-stone-400 text-sm"> Seamless ingestion of borehole assay logs, downhole gamma, and airborne EM surveys.</span>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-[#d3996d]/20 text-[#d3996d] flex items-center justify-center mt-1 flex-shrink-0">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" />
                    </svg>
                  </div>
                  <div>
                    <strong className="text-white text-sm font-semibold">Near-Zero Compute Overhead:</strong>
                    <span className="text-stone-400 text-sm"> Cloud-native pipeline processes regional 10,000 sq km concessions in under 3 hours.</span>
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <Link
                  className="inline-flex items-center gap-2 bg-[#9e5a2a] hover:bg-[#b56832] text-white text-sm font-medium px-6 py-3 rounded-full transition-all duration-200 shadow-md shadow-[#9e5a2a]/30"
                  href="/command-center"
                >
                  Enter Operational Command Center →
                </Link>
              </div>
            </div>

            {/* Right Side: Imagery Card of Heavy Machinery at Work */}
            <div className="lg:col-span-6 relative">
              <div className="relative rounded-2xl overflow-hidden border border-[#2c2520] shadow-2xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt="Mining trucks operating inside open pit bench"
                  className="w-full h-[460px] object-cover object-center filter brightness-90 hover:scale-105 transition-transform duration-700"
                  src="/images/cta-explore.webp"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src =
                      'https://lh3.googleusercontent.com/aida-public/AB6AXuDpdrgG0dOcCmD043CGn1PRcStQushyXQI0qsa0aBwZ2gfwsmriLt9TjjGv0qt9W1RtDTEL4CGy5Vf1rSYeu2h-gwTU0D_5Oa8BZ_2a6Cwb6YMePFVrATOIxI_slR6GwDKSoTKVV49GFGMtvCcAg1Zf7_PktFgcET-kiBkrGNdMuUt-FFBTIx_nxCg_tDmedpq2hcfWZbpoKG_oEkJqII5OMnejjtHVP4jRP1BCdGB8-NEe6K79LyGGhza_erGbhvp9qw';
                  }}
                />
                {/* Overlay Telemetry Floating Tag */}
                <div className="absolute bottom-6 left-6 right-6 p-4 rounded-xl bg-gradient-to-b from-[#1e1915]/90 to-[#14110f]/95 backdrop-blur-md border border-white/10 flex items-center justify-between shadow-xl">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-[#d3996d] font-medium font-['Space_Grotesk']">
                      Haul Fleet Telemetry Sync
                    </div>
                    <div className="text-white font-bold text-sm">Bench 14B — Primary Highwall Shear</div>
                  </div>
                  <div className="text-right">
                    <span className="inline-block px-2.5 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      Target Conviction 94.8%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 5. Social Proof Section ─────────────────────────────────────── */}
      <section className="py-16 bg-[#1a1613] border-y border-[#2c2520]/50" id="proof">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <p className="text-xs uppercase tracking-widest text-stone-400 font-semibold mb-8 font-['Space_Grotesk']">
            Trusted by leading exploration teams and Tier-1 mining operators across India
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-14 opacity-75 grayscale hover:grayscale-0 transition-all duration-300">
            <span className="font-['Space_Grotesk'] font-extrabold text-xl sm:text-2xl tracking-tight text-stone-300">
              GEO<span className="text-[#9e5a2a]">SPECTRA</span>
            </span>
            <span className="font-['Space_Grotesk'] font-bold text-xl sm:text-2xl tracking-widest text-stone-300">
              BHARAT MINING
            </span>
            <span className="font-['Space_Grotesk'] font-black text-xl sm:text-2xl tracking-tighter text-stone-300">
              TERRA<span className="text-[#d3996d]">MIN</span> LABS
            </span>
            <span className="font-['Space_Grotesk'] font-bold text-xl sm:text-2xl tracking-wide text-stone-300">
              SAHARA GOLD CORP
            </span>
            <span className="font-['Space_Grotesk'] font-extrabold text-xl sm:text-2xl tracking-tight text-stone-300">
              EQUATORIAL LITHIUM
            </span>
          </div>
        </div>
      </section>

      {/* ── 6. Call To Action Section ───────────────────────────────────── */}
      <section className="relative py-24 bg-gradient-to-b from-[#1a1613] to-[#14110f]" id="register">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <div className="bg-gradient-to-b from-[#1e1915]/85 to-[#14110f]/95 p-10 sm:p-16 rounded-3xl border border-[#9e5a2a]/30 relative overflow-hidden shadow-2xl">
            {/* Decorative Glow */}
            <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-96 h-96 bg-[#9e5a2a]/20 rounded-full blur-3xl pointer-events-none" />
            
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white font-['Space_Grotesk'] tracking-tight mb-6 relative z-10">
              Accelerate your discovery timeline today
            </h2>
            <p className="text-stone-300 text-base sm:text-lg max-w-2xl mx-auto mb-10 relative z-10 font-sans leading-relaxed">
              Upload your tenement coordinates and receive preliminary hyperspectral alteration overlays, geological shear models, and target anomaly rankings within 24 hours.
            </p>

            {/* CTA Form */}
            {submitted ? (
              <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 max-w-md mx-auto text-sm font-semibold">
                ✓ Concession audit request received. A remote sensing geologist will contact you within 24 hours.
              </div>
            ) : (
              <form className="max-w-md mx-auto flex flex-col sm:flex-row gap-3 relative z-10" onSubmit={handleAuditSubmit}>
                <input
                  className="flex-grow px-5 py-3.5 rounded-full bg-[#14110f] border border-stone-700 text-stone-200 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-[#d3996d] text-sm"
                  placeholder="Enter your exploration email"
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <button
                  className="bg-[#9e5a2a] hover:bg-[#b56832] text-white font-medium px-7 py-3.5 rounded-full text-sm transition-all duration-300 shadow-lg shadow-[#9e5a2a]/30 whitespace-nowrap"
                  type="submit"
                >
                  Get Free Audit
                </button>
              </form>
            )}

            <p className="text-xs text-stone-400 mt-4 relative z-10">
              Instant API access. SOC2 Type II Certified & ISO-13849 Compliant.
            </p>
          </div>
        </div>
      </section>

      {/* ── 7. Main Footer ──────────────────────────────────────────────── */}
      <footer className="bg-[#14110f] border-t border-[#2c2520]/60 py-16 text-stone-400 text-sm" data-purpose="site-footer">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
            {/* Brand Summary Column */}
            <div className="col-span-2">
              <div className="flex items-center gap-3 mb-4">
                <Image
                  src="/icon.svg"
                  alt="Crucible AI Logo"
                  width={32}
                  height={32}
                  className="w-8 h-8 rounded-lg object-contain"
                />
                <span className="font-['Space_Grotesk'] font-bold text-xl text-white tracking-wider">
                  CRUCIBLE<span className="text-[#d3996d]">AI</span>
                </span>
              </div>
              <p className="text-xs text-stone-400 max-w-sm leading-relaxed mb-4">
                Crucible AI delivers deep orbital intelligence, hyperspectral anomaly modeling, and autonomous telemetry systems for mineral exploration enterprises globally.
              </p>
              <div className="text-xs text-stone-400 font-mono">
                Certified ISO-13849 PL-d • SOC2 Type II
              </div>
            </div>

            {/* Links: Platform */}
            <div>
              <h4 className="text-xs font-semibold text-white uppercase tracking-wider mb-4 font-['Space_Grotesk']">
                Platform
              </h4>
              <ul className="space-y-2.5 text-xs">
                <li><Link className="hover:text-[#d3996d] transition-colors" href="/exploration">Satellite Ingestion</Link></li>
                <li><Link className="hover:text-[#d3996d] transition-colors" href="/intelligence">Target Scoring Engine</Link></li>
                <li><Link className="hover:text-[#d3996d] transition-colors" href="/lab">Geophysical Core ML</Link></li>
                <li><Link className="hover:text-[#d3996d] transition-colors" href="/routing">Haul Dispatch Telemetry</Link></li>
                <li><Link className="hover:text-[#d3996d] transition-colors" href="/data-hub">Lakehouse Data Hub</Link></li>
              </ul>
            </div>

            {/* Links: Deposits */}
            <div>
              <h4 className="text-xs font-semibold text-white uppercase tracking-wider mb-4 font-['Space_Grotesk']">
                Deposits
              </h4>
              <ul className="space-y-2.5 text-xs">
                <li><a className="hover:text-[#d3996d] transition-colors" href="#telemetry">Gold & Epithermal</a></li>
                <li><a className="hover:text-[#d3996d] transition-colors" href="#telemetry">Copper Porphyry</a></li>
                <li><a className="hover:text-[#d3996d] transition-colors" href="#telemetry">Lithium Pegmatite</a></li>
                <li><a className="hover:text-[#d3996d] transition-colors" href="#telemetry">Nickel & Cobalt</a></li>
                <li><a className="hover:text-[#d3996d] transition-colors" href="#telemetry">Rare Earth Elements</a></li>
              </ul>
            </div>

            {/* Links: Company */}
            <div>
              <h4 className="text-xs font-semibold text-white uppercase tracking-wider mb-4 font-['Space_Grotesk']">
                Company
              </h4>
              <ul className="space-y-2.5 text-xs">
                <li><a className="hover:text-[#d3996d] transition-colors" href="#capabilities">About Us</a></li>
                <li><Link className="hover:text-[#d3996d] transition-colors" href="/governance">Security & Trust</Link></li>
                <li><Link className="hover:text-[#d3996d] transition-colors" href="/admin">Admin Portal</Link></li>
                <li><Link className="hover:text-[#d3996d] transition-colors" href="/alerts">Operational Sentry</Link></li>
                <li><a className="hover:text-[#d3996d] transition-colors" href="#register">Contact Support</a></li>
              </ul>
            </div>
          </div>

          {/* Bottom Bar */}
          <div className="pt-8 border-t border-stone-800/80 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-stone-400">
            <p>© 2025 Crucible AI Inc. All rights reserved. Mineral exploration data subject to license agreements.</p>
            <div className="flex items-center gap-6">
              <a className="hover:text-stone-300 transition-colors" href="#">Privacy Policy</a>
              <a className="hover:text-stone-300 transition-colors" href="#">Terms of Service</a>
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Systems Operational
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
