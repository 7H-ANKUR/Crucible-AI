'use client';

/**
 * m/layout.tsx — Mobile shell (Stitch Earthy Industrial reskin).
 * Header: hamburger LEFT → slide-in drawer with full nav.
 * No ThemeToggle — light-only.
 */
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { canAccessPage, pagesForRole, ROLE_HOME, ROLE_LABEL, useCrucibleAuth, type Role } from '@/lib/roles';
import { Avatar } from '@/components/crucible/Avatar';
import { useAlertCount } from '@/lib/hooks';

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isSignedIn, role, isSuperAdmin } = useCrucibleAuth();
  const { user } = useUser();
  const alertCount = useAlertCount();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Role guard: department admins stay in their lane on mobile too
  useEffect(() => {
    if (isSignedIn && role && !canAccessPage(role, pathname)) {
      const home = ROLE_HOME[role] ?? '/production';
      router.replace('/m' + home);
    }
  }, [isSignedIn, role, pathname, router]);

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const setDesktopCookie = () => {
    document.cookie = 'crucible_desktop=1; path=/; max-age=604800; samesite=lax';
    window.location.href = '/';
  };

  const goMobile = () => {
    document.cookie = 'crucible_desktop=; path=/; max-age=0';
    window.location.href = '/m';
  };

  const signOut = async () => {
    try {
      await (window as any).Clerk?.signOut?.();
    } catch {
      /* ignore */
    }
    window.location.href = '/m';
  };

  const navItems: { href: string; label: string; icon: string; badge?: number }[] = [
    ...pagesForRole(role).map((p) => ({ href: '/m' + p.href, label: p.label, icon: p.icon })),
    { href: '/m/alerts', label: 'Alerts', icon: 'notifications_active', badge: alertCount },
    { href: '/m/profile', label: 'Profile', icon: 'account_circle' },
    ...(isSuperAdmin
      ? [{ href: '/m/admin', label: 'Manage Admins', icon: 'admin_panel_settings' }]
      : []),
  ];

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <div className="min-h-screen bg-canvas-sandstone text-on-surface flex flex-col">
      {/* ── Slim header ── */}
      <header className="sticky top-0 z-40 flex items-center justify-between px-3 h-14 bg-surface-parchment/95 backdrop-blur-md border-b border-earth-border shadow-[0_1px_8px_rgba(30,25,21,0.04)]">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setDrawerOpen(true)}
            title="Menu"
            className="h-10 w-10 grid place-items-center rounded text-on-surface-variant active:bg-surface-container-high transition-colors"
          >
            <span className="material-symbols-outlined !text-[24px]">menu</span>
          </button>
          <Link href="/m" className="flex items-center gap-1.5">
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
        </div>

        <div className="flex items-center gap-2">
          {/* Telemetry live pill */}
          <div className="flex items-center gap-1 px-2 py-1 rounded border border-earth-border bg-surface-container-high">
            <span className="w-1.5 h-1.5 rounded-full bg-telemetry-emerald animate-pulse" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant">Live</span>
          </div>

          <button
            onClick={setDesktopCookie}
            className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider px-2 py-1 rounded border border-earth-border active:bg-surface-container-high"
          >
            Desktop
          </button>

          {isSignedIn && (
            <Link href="/m/profile" title="Your profile" className="rounded-full active:scale-95 transition-transform">
              <Avatar
                src={user?.imageUrl}
                name={user?.fullName}
                className="w-8 h-8 rounded-full object-cover border border-earth-border"
              />
            </Link>
          )}
        </div>
      </header>

      {/* ── Main content ── */}
      {pathname.startsWith('/m/exploration') ? (
        <main className="flex-1 overflow-hidden" style={{ height: 'calc(100vh - 56px)' }}>
          {children}
        </main>
      ) : (
        <main className="flex-1 p-4">{children}</main>
      )}

      {/* ── Slide-in drawer ── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50" onClick={() => setDrawerOpen(false)}>
          <div className="absolute inset-0 bg-earth-charcoal/40 backdrop-blur-[2px]" />
          <aside
            onClick={(e) => e.stopPropagation()}
            className="absolute top-0 left-0 bottom-0 w-72 bg-surface-parchment border-r border-earth-border shadow-2xl flex flex-col animate-drawerIn"
          >
            {/* Drawer header */}
            <div className="h-14 px-4 flex items-center justify-between border-b border-earth-border bg-surface-container-high">
              <Link href="/m" className="flex items-center gap-1.5" onClick={() => setDrawerOpen(false)}>
                <span
                  className="material-symbols-outlined text-copper-accent text-xl"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  landscape
                </span>
                <div className="flex flex-col leading-tight">
                  <span className="font-['Space_Grotesk'] text-base font-bold text-earth-charcoal tracking-tight">
                    CRUCIBLE AI
                  </span>
                  <span className="text-[9px] font-bold text-copper-accent uppercase tracking-widest">
                    Mineral Core v4.2
                  </span>
                </div>
              </Link>
              <button
                onClick={() => setDrawerOpen(false)}
                className="h-9 w-9 grid place-items-center rounded text-on-surface-variant active:bg-surface-container-highest"
                title="Close menu"
              >
                <span className="material-symbols-outlined !text-[22px]">close</span>
              </button>
            </div>

            {/* Signed-in identity card */}
            {isSignedIn && (
              <Link
                href="/m/profile"
                onClick={() => setDrawerOpen(false)}
                className="mx-3 mt-3 flex items-center gap-3 p-3 rounded bg-surface-container border border-earth-border active:scale-[0.98] transition-transform"
              >
                <Avatar
                  src={user?.imageUrl}
                  name={user?.fullName}
                  className="w-10 h-10 rounded-full object-cover border border-earth-border"
                />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-earth-charcoal truncate">
                    {user?.fullName ?? user?.username ?? 'Profile'}
                  </div>
                  <div className="text-[10px] text-secondary uppercase tracking-wider">
                    {role ? (ROLE_LABEL[role as Role] ?? role) : 'Demo'}
                  </div>
                </div>
              </Link>
            )}

            {/* Nav list */}
            <nav className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-0.5">
              {navItems.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded transition-colors ${
                      active
                        ? 'bg-primary-fixed text-primary font-semibold'
                        : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                    }`}
                  >
                    <span
                      className="material-symbols-outlined !text-[20px] shrink-0"
                      style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}
                    >
                      {item.icon}
                    </span>
                    <span className="text-sm font-medium flex-1">{item.label}</span>
                    {item.badge !== undefined && item.badge > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 bg-telemetry-crimson text-white text-[10px] font-bold rounded-full grid place-items-center">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}

              <div className="border-t border-earth-border my-2" />

              {/* Desktop site */}
              <button
                onClick={setDesktopCookie}
                className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded transition-colors text-left"
              >
                <span className="material-symbols-outlined !text-[20px] shrink-0">desktop_windows</span>
                Desktop site
              </button>

              {/* Sign out / Sign in */}
              {isSignedIn ? (
                <button
                  onClick={signOut}
                  className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-telemetry-crimson hover:bg-telemetry-crimson/10 rounded transition-colors text-left"
                >
                  <span className="material-symbols-outlined !text-[20px] shrink-0">logout</span>
                  Sign out
                </button>
              ) : (
                <Link
                  href="/sign-in"
                  className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-on-surface hover:bg-surface-container-high rounded"
                >
                  <span className="material-symbols-outlined !text-[20px] shrink-0">login</span>
                  Sign in
                </Link>
              )}
            </nav>

            {/* Footer telemetry status */}
            <div className="px-4 py-3 border-t border-earth-border bg-surface-container">
              <div className="flex items-center justify-between px-2 py-1.5 rounded bg-surface-container-high border border-earth-border">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-telemetry-emerald animate-pulse" />
                  <span className="text-[10px] font-bold text-earth-charcoal">TELEMETRY LIVE</span>
                </div>
                <span className="text-[10px] font-bold text-copper-accent">14ms</span>
              </div>
              <button onClick={goMobile} className="text-[10px] text-secondary mt-1.5 hover:text-on-surface-variant">
                Mobile site
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
