'use client';

/**
 * /profile (desktop) — signed-in user's identity card: DP, name, email,
 * role + department scope, account metadata, and session controls.
 * Reskinned to Earthy Industrial.
 */
import React from 'react';
import Link from 'next/link';
import { useUser, useClerk, UserButton } from '@clerk/nextjs';
import { ROLE_LABEL, ROLE_DEPT, pagesForRole, useCrucibleAuth, type Role } from '@/lib/roles';
import { Avatar } from '@/components/crucible/Avatar';

const ROLE_TINT: Record<string, string> = {
  super_admin: 'bg-copper-accent/15 text-copper-accent border-copper-accent/40',
  management: 'bg-surface-container text-secondary border-earth-border',
  production_admin: 'bg-telemetry-emerald/15 text-telemetry-emerald border-telemetry-emerald/40',
  exploration_admin: 'bg-surface-container text-secondary border-earth-border',
  equipment_admin: 'bg-telemetry-amber/15 text-telemetry-amber border-telemetry-amber/40',
  mine_planner: 'bg-copper-accent/10 text-copper-accent border-copper-accent/30',
};

export default function ProfilePage() {
  const { isLoaded, isSignedIn, user } = useUser();
  const { role, isSuperAdmin } = useCrucibleAuth();
  const clerk = useClerk();

  if (!isLoaded) {
    return (
      <main className="flex-1 bg-canvas-sandstone min-h-screen grid place-items-center">
        <div className="w-8 h-8 border-2 border-copper-accent border-t-transparent rounded-full animate-spin" />
      </main>
    );
  }

  if (!isSignedIn || !user) {
    return (
      <main className="flex-1 bg-canvas-sandstone min-h-screen grid place-items-center">
        <div className="text-center">
          <span className="material-symbols-outlined text-secondary text-5xl">account_circle</span>
          <p className="mt-3 text-sm text-secondary">Sign in to view your profile.</p>
          <Link
            href="/sign-in"
            className="inline-block mt-4 text-xs font-bold bg-earth-charcoal text-canvas-sandstone px-6 py-2.5 rounded-full hover:bg-earth-espresso transition-all shadow-sm"
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
    <main className="flex-1 bg-canvas-sandstone min-h-screen p-4 md:p-6 lg:p-8 pb-16">
      <div className="max-w-2xl mx-auto animate-fadeIn">
        {/* Identity card */}
        <div className="bg-surface-parchment rounded-[24px] p-6 md:p-8 border border-earth-border shadow-sm">
          <div className="flex items-center gap-5">
            {/* DP */}
            <div className="relative shrink-0">
              <Avatar
                src={user.imageUrl}
                name={user.fullName}
                className="w-20 h-20 md:w-24 md:h-24 rounded-2xl object-cover border-2 border-copper-accent/40 shadow-sm"
              />
              <span className="absolute -bottom-1.5 -right-1.5 w-4 h-4 rounded-full bg-telemetry-emerald border-2 border-surface-parchment" title="Active" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-bold text-secondary uppercase tracking-widest mb-0.5">Profile</div>
              <h1 className="font-['Space_Grotesk'] text-2xl md:text-3xl font-bold text-earth-charcoal truncate">
                {user.fullName ?? user.username ?? email.split('@')[0]}
              </h1>
              <p className="text-sm text-secondary truncate">{email}</p>
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
          <div className="mt-6 pt-5 border-t border-earth-border grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              ['Department scope', scope, 'workspaces'],
              ['Member since', memberSince, 'calendar_month'],
              ['Auth provider', 'Clerk (JWT session)', 'verified_user'],
              ['User ID', user.id, 'fingerprint'],
            ].map(([label, value, icon]) => (
              <div key={label} className="bg-surface-container-low rounded-xl border border-earth-border p-3.5">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-secondary uppercase tracking-wider mb-1">
                  <span className="material-symbols-outlined !text-[14px] text-secondary">{icon}</span>
                  {label}
                </div>
                <div className="text-xs text-earth-charcoal font-mono truncate">{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Access list */}
        <div className="mt-5 rounded-[24px] bg-surface-parchment border border-earth-border p-5 md:p-6 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-earth-charcoal">Your access</h2>
            {isSuperAdmin && (
              <Link href="/admin" className="text-[11px] font-bold text-copper-accent hover:underline">
                Manage admins →
              </Link>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {accessible.map((p) => (
              <Link
                key={p.href}
                href={p.href}
                className="px-3 py-1.5 rounded-full bg-surface-container-low border border-earth-border text-xs font-semibold text-secondary hover:text-copper-accent hover:border-copper-accent/40 transition-all flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined !text-[15px]">{p.icon}</span>
                {p.label}
              </Link>
            ))}
            <Link
              href="/alerts"
              className="px-3 py-1.5 rounded-full bg-surface-container-low border border-earth-border text-xs font-semibold text-secondary hover:text-copper-accent hover:border-copper-accent/40 transition-all flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined !text-[15px]">notifications_active</span>
              Alerts
            </Link>
          </div>
          {role && ROLE_DEPT[role] !== 'all' && (
            <p className="text-[11px] text-secondary mt-3">
              Department admins see only their department&apos;s problems and analysis. Super admins see everything.
            </p>
          )}
        </div>

        {/* Session controls */}
        <div className="mt-5 flex gap-3">
          <button
            onClick={() => clerk.signOut({ redirectUrl: '/' })}
            className="flex-1 py-3 rounded-xl border border-telemetry-crimson/50 text-xs font-bold uppercase tracking-wider text-telemetry-crimson hover:bg-telemetry-crimson/10 transition-all active:scale-95"
          >
            Sign out
          </button>
          <Link
            href={role ? (ROLE_DEPT[role] === 'all' ? '/production' : `/${ROLE_DEPT[role].replace('planning', 'scenario')}`) : '/production'}
            className="flex-1 py-3 rounded-xl bg-earth-charcoal text-canvas-sandstone text-xs font-bold uppercase tracking-wider hover:bg-earth-espresso transition-all active:scale-95 text-center shadow-sm"
          >
            Back to workspace
          </Link>
        </div>
      </div>
    </main>
  );
}
