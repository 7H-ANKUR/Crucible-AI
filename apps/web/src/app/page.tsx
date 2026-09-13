'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { TopNavBar } from '@/components/minex/Navigation';
import { gsap, ScrollTrigger } from '@/components/minex/SmoothScroll';

const DECISION_LOOP_STAGES = [
  { id: 'data',     label: 'Data',          color: 'bg-[#41606B]', glow: false, desc: 'Real-time ingestion of telemetry, FMS, crusher optical sensors, and drone LIDAR.',                      action: '/production' },
  { id: 'validate', label: 'Validate',       color: 'bg-[#93d3ef]', glow: false, desc: 'Data strata cleansing, synthetic data tagging (12%), and Kalman filtering.',                             action: '/exploration' },
  { id: 'predict',  label: 'Predict',        color: 'bg-[#D99523]', glow: false, desc: 'P50 probabilistic production forecasting and multi-factor bottleneck early warning.',                    action: '/production' },
  { id: 'explain',  label: 'Explain',        color: 'bg-[#ffbd77]', glow: false, desc: 'Full transparency rationale, key operational drivers, and audit trail generation.',                       action: '/scenario' },
  { id: 'simulate', label: 'Simulate',       color: 'bg-[#afcbda]', glow: false, desc: 'Physics-informed discrete event simulation for haul routes and crusher downtime.',                       action: '/scenario' },
  { id: 'approval', label: 'Human approval', color: 'bg-[#2E9B76]', glow: true,  desc: 'Operational Commander verification before dispatching field work orders.',                               action: '/scenario' },
];

const MODULE_CARDS = [
  { href: '/production', icon: 'dashboard',      kicker: 'Live Telemetry & Forecasting', kickerColor: 'text-okt',   title: 'Production Forecasting',  body: 'P50 probabilistic yield models, real-time haulage bottleneck detection, and dense prediction ledger.', cta: 'Launch Live View' },
  { href: '/exploration', icon: 'my_location',   kicker: 'Subsurface Prospectivity',     kickerColor: 'text-infot', title: 'Exploration Intelligence', body: 'Technical GIS layers, electromagnetic anomaly strata, drill hole target reticles, and assay correlation.', cta: 'Inspect Sausar Grid' },
  { href: '/scenario',   icon: 'compare_arrows', kicker: 'Discrete Event Simulation',    kickerColor: 'text-warnt', title: 'Scenario Optimisation',   body: 'Intervention modeling, fleet re-routing, crusher PM delay assessment, and financial impact projections.', cta: 'Open Scenario Workspace' },
];

export default function LandingPage() {
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const modulesRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('[data-hero-text] > *', {
        y: 40, opacity: 0, duration: 0.9, stagger: 0.12, ease: 'power3.out', delay: 0.2,
      });
      gsap.from('[data-hero-card]', {
        x: 60, opacity: 0, duration: 1, ease: 'power3.out', delay: 0.5,
      });
      gsap.from('[data-module-card]', {
        y: 60, opacity: 0, duration: 0.7, stagger: 0.15, ease: 'power2.out',
        scrollTrigger: { trigger: modulesRef.current, start: 'top 75%' } as ScrollTrigger.Vars,
      });
      gsap.from('[data-cta-inner]', {
        y: 40, opacity: 0, duration: 0.8, ease: 'power2.out',
        scrollTrigger: { trigger: ctaRef.current, start: 'top 80%' } as ScrollTrigger.Vars,
      });
    });
    return () => ctx.revert();
  }, []);

  return (
    <div id="landing-screen-root" className="bg-page text-ink">
      <TopNavBar />

      {/* SECTION 1 â€” Hero (sticky, section 2 slides over it) */}
      <div className="sticky top-0 z-10 overflow-hidden">
        <section
          className="relative min-h-screen flex items-center justify-center pt-24 pb-16 px-6 overflow-hidden"
        >
          <div className="absolute inset-0 z-0">
            <div
              className="w-full h-full bg-cover bg-center"
              style={{ backgroundImage: `url('https://lh3.googleusercontent.com/aida-public/AB6AXuA1xMXnZNaGC6oOxyurc461hMIts1ql_SJ7o0Q5NxF-BB3oLk2SqNErzBXNgKwWQ7Mc2X59zIXcRUBKO-wylDSoBzix9ERz3QyYWMA5CXSgVXc_kbFf1XDxAB0Jf92borvrgbQUgBSoHxAUkfUh6UqLL-MYIyARcXwRNwdq2V3H1rke-b63_yeNC-q7u-3BhGt1FwjwJvCYcDC6qxMvn7AslDcn5uL_mye6-JkyWCfXAQsSOnJZbjbnTQ')` }}
            />
            <div className="absolute inset-0 bg-[#07141B]/75 z-10 backdrop-blur-[1px]" />
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] z-10 pointer-events-none" />
          </div>

          <div className="relative z-20 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            <div className="lg:col-span-7 flex flex-col gap-6" data-hero-text>
              <div className="inline-flex items-center gap-2 bg-[#142128]/80 border border-[#544435]/60 px-3.5 py-1.5 rounded-full w-fit backdrop-blur-md">
                <span className="w-2 h-2 rounded-full bg-[#2E9B76] animate-pulse" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#FFC56F]">Industrial Mining Intelligence System</span>
              </div>

              <h1 className="font-['Space_Grotesk'] text-5xl sm:text-6xl md:text-[76px] font-bold text-white leading-[1.08] tracking-tight">
                MINEx: One Mine.<br />
                <span className="text-[#FFC56F]">One Intelligence Layer.</span>
              </h1>

              <p className="text-base sm:text-lg md:text-xl text-[#d9c3af] max-w-2xl leading-relaxed">
                Evidence-backed exploration, production and planning decisions for Indian manganese operations.
              </p>

              <div className="flex flex-wrap gap-4 mt-2">
                <Link href="/login" className="bg-[#f59a23] text-[#623800] text-xs font-bold uppercase tracking-wider px-8 py-4 rounded-[18px] hover:bg-[#FFC56F] transition-all flex items-center gap-2 shadow-lg shadow-[#f59a23]/25 active:scale-95">
                  <span>Sign in to MINEx</span>
                  <span className="material-symbols-outlined text-sm">arrow_forward</span>
                </Link>
                <Link href="/production" className="liquid-glass text-white text-xs font-bold uppercase tracking-wider px-8 py-4 rounded-[18px] hover:bg-white/10 transition-all border border-white/20 active:scale-95 flex items-center gap-2">
                  <span>Explore the platform</span>
                  <span className="material-symbols-outlined text-sm text-[#FFC56F]">auto_awesome</span>
                </Link>
              </div>

              <div className="grid grid-cols-3 gap-4 pt-4 border-t border-white/10 max-w-lg">
                {([['42.8 kt', 'Daily P50 Forecast', '#FFC56F'], ['87%', 'Model Confidence', '#2E9B76'], ['14.2 Mt', 'Target 042-E Reserve', '#93d3ef']] as const).map(([val, label, color]) => (
                  <div key={label}>
                    <div className="font-['Space_Grotesk'] text-2xl font-bold" style={{ color }}>{val}</div>
                    <div className="text-[11px] text-[#afcbda]">{label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-5" data-hero-card>
              <div className="liquid-glass-dark p-6 rounded-[24px] w-full max-w-sm ml-auto shadow-2xl border border-line backdrop-blur-2xl">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-line">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-accentt text-lg">psychology</span>
                    <span className="text-[11px] font-bold text-accentt tracking-widest uppercase">Governed Decision Loop</span>
                  </div>
                  <span className="text-[10px] text-[#afcbda] bg-line px-2 py-0.5 rounded-full">ISO-Compliant</span>
                </div>
                <div className="flex flex-col gap-2 text-sm text-ink">
                  {DECISION_LOOP_STAGES.map((stage, idx) => (
                    <div key={stage.id} className="flex flex-col">
                      <button
                        onClick={() => setActiveStage(stage.id === activeStage ? null : stage.id)}
                        className={`flex items-center justify-between p-2 rounded-lg transition-all text-left ${activeStage === stage.id ? 'bg-panel3 border border-accent/40' : 'hover:bg-frost/5'}`}
                      >
                        <div className="flex items-center gap-3">
                          <span className={`w-2.5 h-2.5 rounded-full ${stage.color} ${stage.glow ? 'shadow-[0_0_10px_rgba(46,155,118,0.8)] animate-pulse' : ''}`} />
                          <span className={`font-medium ${activeStage === stage.id ? 'text-ink font-bold' : ''}`}>{stage.label}</span>
                        </div>
                        <span className="material-symbols-outlined text-xs text-ink3">
                          {activeStage === stage.id ? 'expand_less' : 'info'}
                        </span>
                      </button>
                      {activeStage === stage.id && (
                        <div className="pl-6 pr-2 py-2 text-xs text-[#afcbda] bg-deep2/80 rounded-md my-1 border-l-2 border-accent">
                          <p>{stage.desc}</p>
                          <Link href={stage.action} className="mt-2 text-[11px] font-bold text-accentt hover:underline flex items-center gap-1">
                            <span>Open in Workspace</span>
                            <span className="material-symbols-outlined text-xs">arrow_forward</span>
                          </Link>
                        </div>
                      )}
                      {idx < DECISION_LOOP_STAGES.length - 1 && (
                        <div className="pl-3 border-l border-[#41606B]/40 ml-2 py-0.5">
                          <span className="material-symbols-outlined text-ink3 text-[14px]">arrow_downward</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-4 border-t border-line text-center">
                  <Link href="/production" className="block w-full py-2.5 bg-[#f59a23] hover:bg-accent text-[#623800] text-xs font-bold uppercase rounded-xl transition-colors">
                    Enter Operational Cockpit
                  </Link>
                </div>
              </div>
            </div>
          </div>

          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-white/40 animate-bounce">
            <span className="text-[10px] uppercase tracking-widest font-bold">Scroll</span>
            <span className="material-symbols-outlined text-sm">keyboard_arrow_down</span>
          </div>
        </section>
      </div>

      {/* SECTION 2 â€” Core Modules (slides over hero) */}
      <div className="sticky top-0 z-20 overflow-hidden" ref={modulesRef}>
        <section className="min-h-screen bg-deep flex flex-col justify-center px-6 py-24">
          <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-black/50 to-transparent pointer-events-none" />
          <div className="max-w-7xl mx-auto w-full">
            <div className="text-center mb-14">
              <span className="text-xs font-bold text-accentt uppercase tracking-widest">MINEx Core Operational Modules</span>
              <h2 className="font-['Manrope'] text-4xl md:text-5xl font-bold text-ink mt-2">
                Integrated Industrial<br /><span className="text-accentt">Mining Suite</span>
              </h2>
              <p className="text-ink2 mt-4 max-w-xl mx-auto">Three precision engines. One unified intelligence layer across exploration, production, and planning.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {MODULE_CARDS.map((card) => (
                <Link key={card.href} href={card.href} data-module-card className="liquid-glass-dark p-8 rounded-[28px] border border-line hover:border-accent/50 transition-all group flex flex-col justify-between min-h-[340px]">
                  <div>
                    <div className="w-14 h-14 rounded-2xl bg-panel3 flex items-center justify-center mb-6 text-accentt group-hover:scale-110 transition-transform shadow-lg">
                      <span className="material-symbols-outlined text-3xl">{card.icon}</span>
                    </div>
                    <div className={`text-[11px] font-bold ${card.kickerColor} uppercase mb-2`}>{card.kicker}</div>
                    <h3 className="font-['Manrope'] text-2xl font-bold text-ink mb-3 group-hover:text-accentt transition-colors">{card.title}</h3>
                    <p className="text-sm text-ink2 leading-relaxed">{card.body}</p>
                  </div>
                  <div className="mt-8 flex items-center justify-between pt-4 border-t border-line text-xs font-bold text-accentt">
                    <span>{card.cta}</span>
                    <span className="material-symbols-outlined text-sm group-hover:translate-x-1.5 transition-transform">arrow_forward</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* SECTION 3 â€” CTA + Footer (slides over modules) */}
      <div className="sticky top-0 z-30" ref={ctaRef}>
        <section className="min-h-screen bg-[#07141B] flex flex-col justify-center items-center px-6 py-24 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-black/60 to-transparent pointer-events-none" />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-[600px] h-[600px] rounded-full bg-[#f59a23]/5 blur-[100px]" />
          </div>
          <div className="relative z-10 max-w-3xl mx-auto text-center" data-cta-inner>
            <span className="inline-flex items-center gap-2 bg-[#142128]/80 border border-[#544435]/60 px-3.5 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider text-[#FFC56F] mb-8">
              <span className="w-2 h-2 rounded-full bg-[#2E9B76] animate-pulse" />
              Ready to deploy
            </span>
            <h2 className="font-['Space_Grotesk'] text-5xl md:text-6xl font-bold text-white leading-tight mb-6">
              One platform.<br />
              <span className="text-[#FFC56F]">Every decision.</span>
            </h2>
            <p className="text-lg text-[#afcbda] mb-10 max-w-xl mx-auto leading-relaxed">
              From drill-hole to dispatch â€” MINEx closes the loop between raw telemetry and operational action with full AI governance.
            </p>
            <div className="flex flex-wrap gap-4 justify-center">
              <Link href="/login" className="bg-[#f59a23] text-[#623800] text-sm font-bold uppercase tracking-wider px-10 py-4 rounded-[18px] hover:bg-[#FFC56F] transition-all shadow-lg shadow-[#f59a23]/25 flex items-center gap-2 active:scale-95">
                <span>Get Started</span>
                <span className="material-symbols-outlined text-base">rocket_launch</span>
              </Link>
              <Link href="/governance" className="liquid-glass text-white text-sm font-bold uppercase tracking-wider px-10 py-4 rounded-[18px] hover:bg-white/10 transition-all border border-white/20 flex items-center gap-2 active:scale-95">
                <span>View Governance</span>
                <span className="material-symbols-outlined text-base">policy</span>
              </Link>
            </div>
          </div>
          <footer className="absolute bottom-0 left-0 right-0 px-8 py-6 flex flex-col md:flex-row justify-between items-center border-t border-white/10">
            <div className="flex items-center gap-4 mb-3 md:mb-0">
              <span className="font-['Manrope'] text-2xl font-bold text-[#FFC56F]">MINEx</span>
              <span className="text-xs text-[#afcbda]">2026 MINEx Industrial. Precision Engineering for Indian Manganese Operations.</span>
            </div>
            <nav className="flex flex-wrap gap-5 text-xs text-[#afcbda]">
              <Link href="/production" className="hover:text-white transition-colors">Production</Link>
              <Link href="/governance" className="hover:text-white transition-colors">Governance</Link>
              <Link href="/exploration" className="hover:text-white transition-colors">Exploration</Link>
              <Link href="/scenario" className="hover:text-white transition-colors">Scenarios</Link>
              <a href="/m" className="hover:text-[#FFC56F] transition-colors">Mobile site</a>
            </nav>
          </footer>
        </section>
      </div>
    </div>
  );
}

