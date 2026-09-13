'use client';

/**
 * /profile (desktop) — signed-in user's identity card: DP, name, email,
 * role + department scope, account metadata, and session controls.
 */
import React from 'react';
import Link from 'next/link';
import { useUser, useClerk, UserButton } from '@clerk/nextjs';
import { ROLE_LABEL, ROLE_DEPT, pagesForRole, useCrucibleAuth, type Role } from '@/lib/roles';
import { Avatar } from '@/components/crucible/Avatar';

const ROLE_TINT: Record<string, string> = {
  super_admin: 'bg-accent/15 text-accentt border-accent/40',
  management: 'bg-info/15 text-infot border-info/40',
  production_admin: 'bg-ok/15 text-okt border-ok/40',
  exploration_admin: 'bg-info/15 text-infot border-info/40',
  equipment_admin: 'bg-warn/15 text-warnt border-warn/40',
  mine_planner: 'bg-accent2/15 text-accentt border-accent2/40',
};

export default function ProfilePage() {
  const { isLoaded, isSignedIn, user } = useUser();
  const { role, isSuperAdmin } = useCrucibleAuth();
  const clerk = useClerk();

  if (!isLoaded) {
    return (
      <main className="flex-1 bg-deep min-h-screen grid place-items-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  if (!isSignedIn || !user) {
    return (
      <main className="flex-1 bg-deep min-h-screen grid place-items-center">
        <div className="text-center">
          <span className="material-symbols-outlined text-ink3 text-5xl">account_circle</span>
          <p className="mt-3 text-sm text-ink2">Sign in to view your profile.</p>
          <Link
            href="/login"
            className="inline-block mt-4 text-xs font-bold bg-btn text-btnt px-6 py-2.5 rounded-full hover:bg-btn/90 transition-all"
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? '—';
  const memberSince = user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const scope = role ? (ROLE_DEPT[role] === 'all' ? 'All departments' : `${ROLE_LABEL[role]} scope`) : 'Demo (signed out role)';
  const accessible = pagesForRole(role);

  return (
    <main className="flex-1 bg-deep min-h-screen p-4 md:p-6 lg:p-8 pb-16">
      <div className="max-w-2xl mx-auto animate-fadeIn">
        {/* Identity card */}
        <div className="liquid-glass-dark rounded-[24px] p-6 md:p-8 border border-frost/10 shadow-2xl">
          <div className="flex items-center gap-5">
            {/* DP */}
            <div className="relative shrink-0">
              <Avatar
                src={user.imageUrl}
                name={user.fullName}
                className="w-20 h-20 md:w-24 md:h-24 rounded-2xl object-cover border-2 border-accent/50 shadow-[0_0_24px_rgba(255,197,111,0.25)]"
              />
              <span className="absolute -bottom-1.5 -right-1.5 w-4 h-4 rounded-full bg-ok border-2 border-page" title="Active" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-bold text-ink3 uppercase tracking-widest mb-0.5">Profile</div>
              <h1 className="font-['Manrope'] text-2xl md:text-3xl font-bold text-ink truncate">
                {user.fullName ?? user.username ?? email.split('@')[0]}
              </h1>
              <p className="text-sm text-ink2 truncate">{email}</p>
              {role && (
                <span className={`inline-block mt-2 px-3 py-1 rounded-full border text-[11px] font-bold uppercase tracking-wider ${ROLE_TINT[role] ?? ROLE_TINT.management}`}>
                  {ROLE_LABEL[role as Role] ?? role}
                </span>
              )}
            </div>
            <div className="ml-auto shrink-0">
              <UserButton />
            </div>
          </div>

          {/* Account details */}
          <div className="mt-6 pt-5 border-t border-line grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              ['Department scope', scope, 'workspaces'],
              ['Member since', memberSince, 'calendar_month'],
              ['Auth provider', 'Clerk (JWT session)', 'verified_user'],
              ['User ID', user.id, 'fingerprint'],
            ].map(([label, value, icon]) => (
              <div key={label} className="bg-deep2 rounded-xl border border-line p-3.5">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-ink2 uppercase tracking-wider mb-1">
                  <span className="material-symbols-outlined !text-[14px] text-ink3">{icon}</span>
                  {label}
                </div>
                <div className="text-xs text-ink font-mono truncate">{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Access list */}
        <div className="mt-5 rounded-[24px] bg-deep2 border border-line p-5 md:p-6 shadow-xl">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink">Your access</h2>
            {isSuperAdmin && (
              <Link href="/admin" className="text-[11px] font-bold text-accentt hover:underline">
                Manage admins →
              </Link>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {accessible.map((p) => (
              <Link
                key={p.href}
                href={p.href}
                className="px-3 py-1.5 rounded-full bg-panel2 border border-line text-xs font-semibold text-ink2 hover:text-accentt hover:border-accent/40 transition-all flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined !text-[15px]">{p.icon}</span>
                {p.label}
              </Link>
            ))}
            <Link
              href="/alerts"
              className="px-3 py-1.5 rounded-full bg-panel2 border border-line text-xs font-semibold text-ink2 hover:text-accentt hover:border-accent/40 transition-all flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined !text-[15px]">notifications_active</span>
              Alerts
            </Link>
          </div>
          {role && ROLE_DEPT[role] !== 'all' && (
            <p className="text-[11px] text-ink3 mt-3">
              Department admins see only their department&apos;s problems and analysis. Super admins see everything.
            </p>
          )}
        </div>

        {/* Session controls */}
        <div className="mt-5 flex gap-3">
          <button
            onClick={() => clerk.signOut({ redirectUrl: '/' })}
            className="flex-1 py-3 rounded-xl border border-danger/50 text-xs font-bold uppercase tracking-wider text-dangert hover:bg-danger/10 transition-all active:scale-95"
          >
            Sign out
          </button>
          <Link
            href={role ? (ROLE_DEPT[role] === 'all' ? '/production' : `/${ROLE_DEPT[role].replace('planning', 'scenario')}`) : '/production'}
            className="flex-1 py-3 rounded-xl bg-accent text-onaccent text-xs font-bold uppercase tracking-wider hover:bg-accent2 transition-all active:scale-95 text-center"
          >
            Back to workspace
          </Link>
        </div>
      </div>
    </main>
  );
}
