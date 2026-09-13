'use client';

/**
 * Navigation — deliberately minimal chrome.
 * Topbar: brand + permitted pages + alerts + user.
 * Sidebar: grouped IA sections (OVERVIEW/EXPLORE/OPERATE/PLAN/DECIDE/DATA/TRUST).
 *          Collapses to 68px icon-only, expands to 224px on hover.
 *          Section labels and NEW chips fade in with the sidebar.
 */
import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { useCrucibleAuth, pagesForRole, groupsForRole } from '@/lib/roles';
import { ThemeToggle } from '@/components/crucible/ThemeToggle';
import { Avatar } from '@/components/crucible/Avatar';

export function TopNavBar() {
  const pathname = usePathname();
  const { role, isSuperAdmin, isSignedIn } = useCrucibleAuth();
  const pages = pagesForRole(role);
  // Longest href first: '/data-hub' must win over '/data' if both ever exist.
  const currentPage = [...pages]
    .sort((a, b) => b.href.length - a.href.length)
    .find((p) => pathname === p.href || pathname.startsWith(`${p.href}/`));
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (pathname === '/') {
    return (
      <header
        id="landing-navbar"
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 sm:px-8 py-3 bg-page/60 rounded-full mt-4 mx-auto max-w-3xl backdrop-blur-xl border border-frost/20 shadow-2xl"
      >
        <Link href="/" className="flex items-center gap-2 group">
          <span className="material-symbols-outlined text-accentt text-3xl group-hover:scale-110 transition-transform" style={{ fontVariationSettings: "'FILL' 1" }}>
            landscape
          </span>
          <span className="font-['Space_Grotesk'] text-2xl sm:text-[28px] font-bold text-accentt tracking-tight">Crucible AI</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm font-bold bg-btn text-btnt px-5 sm:px-6 py-2 rounded-full hover:bg-btn/90 active:scale-95 transition-all shadow-md">
            Sign in
          </Link>
        </div>
      </header>
    );
  }

  return (
    <>
      <nav id="app-topbar" className="sticky top-0 z-40 flex justify-between items-center w-full px-5 py-2 bg-panel/90 backdrop-blur-xl border-b border-line2/50 shadow-sm">
        <div className="flex items-center gap-3 md:gap-4">
          <button onClick={() => setDrawerOpen(true)} className="md:hidden p-1.5 -ml-1.5 text-ink2 hover:text-ink active:bg-panel3 rounded-xl transition-colors">
            <span className="material-symbols-outlined !text-[24px]">menu</span>
          </button>
          <Link href="/" className="font-['Manrope'] text-xl font-black text-accentt hover:opacity-90 transition-opacity tracking-tight">Crucible AI</Link>
          {/* The sidebar is the navigation. Repeating every page here duplicated
              it at every width above md and made the two compete for the role.
              The topbar now says where you are instead. */}
          {currentPage && (
            <div className="hidden md:flex items-center gap-2 pl-3 border-l border-line2/50">
              <span className="material-symbols-outlined !text-[16px] text-ink3">
                {currentPage.icon}
              </span>
              <span className="text-xs font-semibold text-ink">{currentPage.label}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {isSuperAdmin && (
            <Link href="/admin" className={`p-2 rounded-full transition-colors ${pathname.startsWith('/admin') ? 'text-accentt bg-panel4/50' : 'text-ink2 hover:text-accentt hover:bg-panel4/50'}`} title="Admin management">
              <span className="material-symbols-outlined !text-[20px]">admin_panel_settings</span>
            </Link>
          )}
          <UserArea isSignedIn={isSignedIn} />
        </div>
      </nav>

      {/* Mobile Slide-in drawer — grouped IA */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setDrawerOpen(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
          <aside onClick={(e) => e.stopPropagation()} className="absolute top-0 left-0 bottom-0 w-[260px] bg-panel border-r border-line shadow-2xl flex flex-col animate-fadeIn">
            <div className="px-4 pt-4 pb-3 border-b border-line flex items-center justify-between">
              <span className="font-['Space_Grotesk'] text-lg font-bold text-accentt tracking-tight">Crucible AI</span>
              <button onClick={() => setDrawerOpen(false)} className="p-1 rounded-lg text-ink3 hover:text-ink active:bg-panel3">
                <span className="material-symbols-outlined !text-[22px]">close</span>
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3 flex flex-col gap-0.5">
              {groupsForRole(role).map((group) => (
                <div key={group.label}>
                  <div className="px-3 pt-3 pb-1 text-[9px] font-black tracking-[0.15em] text-ink3 uppercase">{group.label}</div>
                  {group.pages.map((tab) => (
                    <Link key={tab.href + tab.label} href={tab.href} onClick={() => setDrawerOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors ${pathname.startsWith(tab.href) ? 'bg-chipon text-inkb font-bold' : 'text-ink2 hover:text-ink hover:bg-panel3'}`}>
                      <span className="material-symbols-outlined !text-[20px]">{tab.icon}</span>
                      <span className="font-semibold text-sm">{tab.label}</span>
                      {tab.isNew && <span className="ml-auto text-[9px] font-black tracking-wider bg-accentt/20 text-accentt border border-accentt/30 px-1.5 py-0.5 rounded-full">NEW</span>}
                    </Link>
                  ))}
                </div>
              ))}
            </nav>
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
      <Link href="/login" className="flex items-center gap-1.5 text-xs font-bold text-btnt bg-btn hover:bg-btn/90 px-4 py-1.5 rounded-full transition-all">
        <span className="material-symbols-outlined !text-[16px]">login</span>
        Sign in
      </Link>
    );
  }
  return (
    <Link href="/profile" title="Your profile" className="rounded-full hover:ring-2 hover:ring-accent/50 transition-all">
      <Avatar src={user?.imageUrl} name={user?.fullName} className="w-8 h-8 rounded-full object-cover border border-line2" />
    </Link>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function SideNavBar({ alertCount = 0 }: { alertCount?: number } = {}) {
  const pathname = usePathname();
  const { role } = useCrucibleAuth();
  const groups = groupsForRole(role);

  return (
    <aside
      id="side-navbar"
      className="hidden md:flex fixed left-0 top-[52px] bottom-0 z-30 flex-col pt-4 pb-5 bg-panel2 dark:bg-deep border-r border-line2/40 shadow-md w-[68px] hover:w-56 transition-all duration-300 overflow-hidden group"
    >
      <nav className="flex-1 flex flex-col gap-0 px-2 overflow-y-auto">
        {groups.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? 'mt-1' : ''}>
            {/* Section label — fades in when sidebar expands */}
            <div className="px-2 pt-2 pb-0.5 text-[9px] font-black tracking-[0.15em] text-ink3 uppercase opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
              {group.label}
            </div>
            {group.pages.map((item) => {
              const isSelected = pathname.startsWith(item.href);
              return (
                <Link key={item.href + item.label} href={item.href} title={item.label}
                  className={`relative flex items-center gap-3.5 py-2 px-3 rounded-xl mx-0.5 transition-all whitespace-nowrap overflow-hidden ${
                    isSelected ? 'bg-chipon text-inkb font-bold shadow-md' : 'text-ink2 hover:text-ink hover:bg-panel4/50'
                  }`}>
                  <span className="material-symbols-outlined shrink-0 text-[22px]" style={{ fontVariationSettings: isSelected ? "'FILL' 1" : "'FILL' 0" }}>
                    {item.icon}
                  </span>
                  <span className="text-xs uppercase tracking-wider font-bold opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex-1">
                    {item.label}
                  </span>
                  {item.href === '/alerts' && alertCount > 0 && (
                    <>
                      {/* Visible while collapsed, where the label is hidden. */}
                      <span className="absolute left-7 top-1.5 w-2 h-2 rounded-full bg-warn group-hover:opacity-0 transition-opacity duration-300" />
                      <span className="text-[9px] font-black tracking-wider bg-warn/20 text-warn border border-warn/30 px-1.5 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 shrink-0">
                        {alertCount > 99 ? '99+' : alertCount}
                      </span>
                    </>
                  )}
                  {item.isNew && (
                    <span className="text-[9px] font-black tracking-wider bg-accentt/20 text-accentt border border-accentt/30 px-1.5 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300 shrink-0">
                      NEW
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="px-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap">
        <div className="text-[10px] text-ink3 tracking-widest uppercase mb-1">System Status</div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-ok shadow-[0_0_8px_rgba(46,155,118,0.8)]"></span>
          <span className="text-[12px] font-medium text-okt">Operational</span>
        </div>
      </div>
    </aside>
  );
}