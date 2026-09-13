'use client';

/**
 * m/layout.tsx — mobile shell: hamburger (top-left) opens a slide-in drawer
 * with every option; content area; no bottom bar.
 * Same Clerk auth and role model as the desktop app (shared root layout).
 */
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { canAccessPage, pagesForRole, ROLE_HOME, ROLE_LABEL, useCrucibleAuth, type Role } from '@/lib/roles';
import { ThemeToggle } from '@/components/crucible/ThemeToggle';
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

  // Close the drawer on navigation
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
    <div className="min-h-screen bg-page text-ink flex flex-col">
      {/* Slim header — hamburger LEFT */}
      <header className="sticky top-0 z-40 flex items-center justify-between px-3 h-[52px] bg-panel/95 backdrop-blur-xl border-b border-line">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setDrawerOpen(true)}
            title="Menu"
            className="h-10 w-10 grid place-items-center rounded-xl text-ink2 active:bg-panel3 transition-colors"
          >
            <span className="material-symbols-outlined !text-[24px]">menu</span>
          </button>
          <Link href="/m" className="flex items-center gap-1.5">
            <span
              className="material-symbols-outlined text-accentt text-xl"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              landscape
            </span>
            <span className="font-['Space_Grotesk'] text-lg font-bold text-accentt tracking-tight">Crucible AI</span>
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle compact />
          <button
            onClick={setDesktopCookie}
            className="text-[10px] font-bold text-ink3 uppercase tracking-wider px-2 py-1 rounded-full border border-line active:bg-panel3"
          >
            Desktop
          </button>
          {isSignedIn && (
            <Link href="/m/profile" title="Your profile" className="rounded-full active:scale-95 transition-transform">
              <Avatar
                src={user?.imageUrl}
                name={user?.fullName}
                className="w-8 h-8 rounded-full object-cover border border-line3"
              />
            </Link>
          )}
        </div>
      </header>

      {/* Map pages need full viewport height with zero padding */}
      {pathname.startsWith('/m/exploration') ? (
        <main className="flex-1 overflow-hidden" style={{ height: 'calc(100vh - 52px)' }}>{children}</main>
      ) : (
        <main className="flex-1 p-4">{children}</main>
      )}

      {/* Slide-in drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50" onClick={() => setDrawerOpen(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
          <aside
            onClick={(e) => e.stopPropagation()}
            className="absolute top-0 left-0 bottom-0 w-[290px] bg-panel border-r border-line shadow-2xl flex flex-col animate-drawerIn"
          >
            {/* Drawer header */}
            <div className="px-4 pt-4 pb-3 border-b border-line flex items-center justify-between">
              <Link href="/m" className="flex items-center gap-1.5" onClick={() => setDrawerOpen(false)}>
                <span
                  className="material-symbols-outlined text-accentt text-xl"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  landscape
                </span>
                <span className="font-['Space_Grotesk'] text-lg font-bold text-accentt tracking-tight">Crucible AI</span>
              </Link>
              <button
                onClick={() => setDrawerOpen(false)}
                className="h-9 w-9 grid place-items-center rounded-lg text-ink3 active:bg-panel3"
                title="Close menu"
              >
                <span className="material-symbols-outlined !text-[22px]">close</span>
              </button>
            </div>

            {/* Signed-in identity */}
            {isSignedIn && (
              <Link
                href="/m/profile"
                onClick={() => setDrawerOpen(false)}
                className="mx-3 mt-3 flex items-center gap-3 p-2.5 rounded-xl bg-deep2 border border-line active:scale-[0.98] transition-transform"
              >
                <Avatar
                  src={user?.imageUrl}
                  name={user?.fullName}
                  className="w-10 h-10 rounded-full object-cover border border-line3"
                />
                <div className="min-w-0">
                  <div className="text-sm font-bold text-ink truncate">
                    {user?.fullName ?? user?.username ?? 'Profile'}
                  </div>
                  <div className="text-[10px] text-ink3 uppercase tracking-wider">
                    {role ? (ROLE_LABEL[role as Role] ?? role) : 'Demo'}
                  </div>
                </div>
              </Link>
            )}

            {/* Nav list — all options */}
            <nav className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-1">
              {navItems.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3.5 px-3.5 py-3 rounded-xl transition-colors ${
                      active
                        ? 'bg-chipon text-inkb font-bold'
                        : 'text-ink2 hover:text-ink hover:bg-panel3'
                    }`}
                  >
                    <span
                      className="material-symbols-outlined !text-[22px] shrink-0"
                      style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}
                    >
                      {item.icon}
                    </span>
                    <span className="text-sm font-semibold flex-1">{item.label}</span>
                    {item.badge !== undefined && item.badge > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 bg-danger text-white text-[10px] font-bold rounded-full grid place-items-center">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}

              <div className="border-t border-line my-2" />

              {/* Theme + desktop */}
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <span className="text-sm font-semibold text-ink2 flex items-center gap-3.5">
                  <span className="material-symbols-outlined !text-[22px] shrink-0">contrast</span>
                  Theme
                </span>
                <ThemeToggle />
              </div>
              <button
                onClick={setDesktopCookie}
                className="flex items-center gap-3.5 px-3.5 py-2.5 text-sm font-semibold text-ink2 hover:text-ink hover:bg-panel3 rounded-xl transition-colors text-left"
              >
                <span className="material-symbols-outlined !text-[22px] shrink-0">desktop_windows</span>
                Desktop site
              </button>
              {isSignedIn ? (
                <button
                  onClick={signOut}
                  className="flex items-center gap-3.5 px-3.5 py-2.5 text-sm font-semibold text-dangert hover:bg-danger/10 rounded-xl transition-colors text-left"
                >
                  <span className="material-symbols-outlined !text-[22px] shrink-0">logout</span>
                  Sign out
                </button>
              ) : (
                <Link
                  href="/login"
                  className="flex items-center gap-3.5 px-3.5 py-2.5 text-sm font-semibold text-ink hover:bg-panel3 rounded-xl"
                >
                  <span className="material-symbols-outlined !text-[22px] shrink-0">login</span>
                  Sign in
                </Link>
              )}
            </nav>

            {/* Footer status */}
            <div className="px-5 py-3 border-t border-line">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-ok shadow-[0_0_8px_rgba(46,155,118,0.6)]" />
                <span className="text-[11px] font-medium text-ok">All systems operational</span>
              </div>
              <button onClick={goMobile} className="text-[10px] text-ink3 mt-1 hover:text-ink2">
                Mobile site
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
