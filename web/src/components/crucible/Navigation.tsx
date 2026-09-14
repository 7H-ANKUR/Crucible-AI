'use client';

/**
 * Navigation — Stitch "Earthy Industrial" reskin.
 * Topbar: brand + current page breadcrumb + admin + user.
 * Sidebar: full-height fixed left panel, 64px wide collapsed → 224px on hover.
 *          Solid surface-parchment background, earth-border separators.
 *          No ThemeToggle (light-only).
 */
import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { useCrucibleAuth, pagesForRole, groupsForRole } from '@/lib/roles';
import { Avatar } from '@/components/crucible/Avatar';

export function TopNavBar() {
  const pathname = usePathname();
  const { role, isSuperAdmin, isSignedIn } = useCrucibleAuth();
  const pages = pagesForRole(role);
  // Longest href first so '/data-hub' wins over '/data'.
  const currentPage = [...pages]
    .sort((a, b) => b.href.length - a.href.length)
    .find((p) => pathname === p.href || pathname.startsWith(`${p.href}/`));
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Landing page — minimal pill navbar
  if (pathname === '/') {
    return (
      <header
        id="landing-navbar"
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 sm:px-8 py-3 bg-surface-parchment/90 backdrop-blur-md border border-earth-border rounded-full mt-4 mx-auto max-w-3xl shadow-md"
      >
        <Link href="/" className="flex items-center gap-2 group">
          <span
            className="material-symbols-outlined text-copper-accent text-3xl group-hover:scale-110 transition-transform"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            landscape
          </span>
          <span className="font-['Space_Grotesk'] text-2xl sm:text-[28px] font-bold text-earth-charcoal tracking-tight">
            Crucible AI
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href="/sign-in"
            className="text-sm font-bold bg-primary text-on-primary px-5 sm:px-6 py-2 rounded hover:bg-primary-container active:scale-95 transition-all shadow-sm"
          >
            Sign in
          </Link>
        </div>
      </header>
    );
  }

  return (
    <>
      {/* ── Top header bar ── */}
      <header
        id="app-topbar"
        className="fixed top-0 left-0 md:left-64 right-0 h-16 bg-surface-parchment/95 backdrop-blur-md border-b border-earth-border z-40 px-space-lg flex items-center justify-between shadow-[0_1px_8px_rgba(0,0,0,0.04)]"
      >
        <div className="flex items-center gap-space-md">
          {/* Mobile hamburger */}
          <button
            onClick={() => setDrawerOpen(true)}
            className="md:hidden p-1.5 -ml-1.5 text-on-surface-variant hover:text-on-surface active:bg-surface-container-high rounded transition-colors"
          >
            <span className="material-symbols-outlined !text-[24px]">menu</span>
          </button>

          {/* Brand */}
          <Link
            href="/"
            className="font-headline-sm text-headline-sm font-bold text-earth-charcoal hover:text-copper-accent tracking-tight transition-colors md:hidden"
          >
            Crucible AI
          </Link>

          {/* Breadcrumb — current page */}
          {currentPage && (
            <div className="hidden md:flex items-center gap-space-xs text-on-surface-variant font-label-md text-label-md">
              <span className="text-secondary">Crucible</span>
              <span className="material-symbols-outlined text-[14px] text-outline">chevron_right</span>
              <span className="text-earth-charcoal font-semibold uppercase tracking-wider">
                {currentPage.label}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-space-md">
          {/* Sync status pill */}
          <div className="hidden sm:flex items-center gap-space-xs px-space-sm py-space-xs rounded bg-surface-container-high border border-earth-border">
            <span className="material-symbols-outlined text-telemetry-emerald text-[16px]">sync</span>
            <span className="font-label-sm text-label-sm text-on-surface-variant">SYNC: 100% NOMINAL</span>
          </div>

          {/* Admin link */}
          {isSuperAdmin && (
            <Link
              href="/admin"
              className={`font-label-md text-label-md flex items-center gap-space-xs transition-colors ${
                pathname.startsWith('/admin')
                  ? 'text-primary'
                  : 'text-on-surface-variant hover:text-primary'
              }`}
              title="Admin management"
            >
              <span className="material-symbols-outlined text-[18px]">settings</span>
              <span className="hidden sm:inline">Admin</span>
            </Link>
          )}
          
          <div className="h-4 w-px bg-earth-border hidden sm:block"></div>
          <UserArea isSignedIn={isSignedIn} />
        </div>
      </header>

      {/* ── Mobile slide-in drawer ── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setDrawerOpen(false)}>
          <div className="absolute inset-0 bg-earth-charcoal/40 backdrop-blur-[2px]" />
          <aside
            onClick={(e) => e.stopPropagation()}
            className="absolute top-0 left-0 bottom-0 w-64 bg-surface-parchment border-r border-earth-border shadow-2xl flex flex-col animate-drawerIn"
          >
            {/* Drawer header */}
            <div className="h-16 px-4 flex items-center justify-between border-b border-earth-border bg-surface-container-high">
              <Link href="/" onClick={() => setDrawerOpen(false)} className="flex items-center gap-2">
                <span
                  className="material-symbols-outlined text-copper-accent text-xl"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  landscape
                </span>
                <span className="font-['Space_Grotesk'] text-lg font-bold text-earth-charcoal tracking-tight">
                  Crucible AI
                </span>
              </Link>
              <button
                onClick={() => setDrawerOpen(false)}
                className="p-1 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest"
              >
                <span className="material-symbols-outlined !text-[22px]">close</span>
              </button>
            </div>

            {/* Nav list */}
            <nav className="flex-1 overflow-y-auto py-3 px-3 flex flex-col gap-0">
              {groupsForRole(role).map((group) => (
                <div key={group.label}>
                  <div className="px-3 pt-3 pb-1 text-[9px] font-bold tracking-[0.15em] text-secondary uppercase">
                    {group.label}
                  </div>
                  {group.pages.map((tab) => {
                    const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
                    return (
                      <Link
                        key={tab.href + tab.label}
                        href={tab.href}
                        onClick={() => setDrawerOpen(false)}
                        className={`flex items-center gap-3 px-3 py-2 rounded transition-colors ${
                          active
                            ? 'bg-primary-fixed text-primary font-semibold'
                            : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                        }`}
                      >
                        <span
                          className="material-symbols-outlined !text-[20px]"
                          style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}
                        >
                          {tab.icon}
                        </span>
                        <span className="text-sm font-medium">{tab.label}</span>
                        {tab.isNew && (
                          <span className="ml-auto text-[9px] font-bold tracking-wider bg-copper-accent/20 text-copper-accent border border-copper-accent/30 px-1.5 py-0.5 rounded">
                            NEW
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>

            {/* Status footer */}
            <div className="px-4 py-3 border-t border-earth-border bg-surface-container">
              <div className="flex items-center justify-between px-2 py-1.5 rounded bg-surface-container-high border border-earth-border">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-telemetry-emerald animate-pulse" />
                  <span className="text-[10px] font-bold text-earth-charcoal">TELEMETRY LIVE</span>
                </div>
                <span className="text-[10px] font-bold text-copper-accent">14ms</span>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function UserArea({ isSignedIn }: { isSignedIn: boolean }) {
  const { user } = useUser();
  if (!isSignedIn) {
    return (
      <Link
        href="/sign-in"
        className="flex items-center gap-1.5 text-xs font-bold text-on-primary bg-primary hover:bg-primary-container px-4 py-1.5 rounded transition-all shadow-sm"
      >
        <span className="material-symbols-outlined !text-[16px]">login</span>
        Sign in
      </Link>
    );
  }
  return (
    <Link href="/profile" title="Your profile" className="rounded-full hover:ring-2 hover:ring-copper-accent/40 transition-all">
      <Avatar
        src={user?.imageUrl}
        name={user?.fullName}
        className="w-8 h-8 rounded-full object-cover border border-earth-border"
      />
    </Link>
  );
}

export function SideNavBar({ alertCount = 0 }: { alertCount?: number } = {}) {
  const pathname = usePathname();
  const { role } = useCrucibleAuth();
  const groups = groupsForRole(role);

  return (
    <aside className="hidden md:flex fixed left-0 top-0 h-full w-64 bg-surface-parchment border-r border-earth-border z-50 flex-col justify-between shadow-[0_1px_8px_rgba(0,0,0,0.04)]">
      <div className="flex flex-col h-full">
        <div className="h-16 px-space-md flex items-center gap-space-sm border-b border-earth-border bg-surface-container-high shrink-0">
          <span
            className="material-symbols-outlined text-copper-accent text-[32px] group-hover:scale-110 transition-transform"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            landscape
          </span>
          <div className="flex flex-col">
            <span className="font-headline-sm text-[18px] text-earth-charcoal tracking-tight font-bold">CRUCIBLE AI</span>
            <span className="font-label-sm text-label-sm text-copper-accent uppercase tracking-wider">Mineral Core v4.2</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-space-sm px-space-sm">
          <nav className="space-y-space-md">
            {groups.map((group) => (
              <div key={group.label} className="space-y-space-xs">
                <div className="px-space-sm py-space-xs font-label-sm text-label-sm uppercase tracking-wider text-secondary">
                  {group.label}
                </div>
                {group.pages.map((item) => {
                  const isSelected = pathname === item.href || pathname.startsWith(item.href + '/');
                  return (
                    <Link
                      key={item.href + item.label}
                      href={item.href}
                      className={`flex items-center gap-space-sm px-space-sm py-space-xs rounded transition-colors ${
                        isSelected
                          ? 'bg-primary-container text-on-primary-container font-label-md'
                          : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface font-label-md'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {item.icon}
                      </span>
                      <span className="font-label-md text-label-md flex-1">
                        {item.label}
                      </span>

                      {/* Alert badge */}
                      {item.href === '/alerts' && alertCount > 0 && (
                        <span className="text-[10px] font-bold bg-telemetry-crimson/15 text-telemetry-crimson border border-telemetry-crimson/30 px-1.5 py-0.5 rounded shrink-0">
                          {alertCount > 99 ? '99+' : alertCount}
                        </span>
                      )}

                      {/* New badge */}
                      {item.isNew && (
                        <span className="text-[10px] font-bold bg-copper-accent/15 text-copper-accent border border-copper-accent/30 px-1.5 py-0.5 rounded shrink-0">
                          NEW
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </div>

        <div className="p-space-sm border-t border-earth-border bg-surface-container-low">
          <div className="flex items-center justify-between px-space-xs py-space-xs rounded bg-surface-container border border-earth-border">
            <div className="flex items-center gap-space-xs">
              <span className="w-2 h-2 rounded-full bg-telemetry-emerald animate-pulse"></span>
              <span className="font-label-sm text-label-sm text-earth-charcoal">TELEMETRY LIVE</span>
            </div>
            <span className="font-label-sm text-label-sm text-copper-accent font-semibold">14ms</span>
          </div>
        </div>
      </div>
    </aside>
  );
}