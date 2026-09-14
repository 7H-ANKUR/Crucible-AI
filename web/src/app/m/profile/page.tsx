'use client';

/**
 * m/profile — mobile identity card: DP, name, role, scope, session controls.
 * Reskinned to Earthy Industrial.
 */
import React from 'react';
import Link from 'next/link';
import { useUser, useClerk, UserButton } from '@clerk/nextjs';
import { ROLE_LABEL, ROLE_DEPT, pagesForRole, useCrucibleAuth, type Role } from '@/lib/roles';
import { Card, PageHeader } from '@/components/mobile/ui';
import { Avatar } from '@/components/crucible/Avatar';

export default function MobileProfile() {
  const { isLoaded, isSignedIn, user } = useUser();
  const { role, isSuperAdmin } = useCrucibleAuth();
  const clerk = useClerk();

  if (!isLoaded) {
    return (
      <div className="grid place-items-center py-20">
        <div className="w-8 h-8 border-2 border-copper-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isSignedIn || !user) {
    return (
      <div className="text-center py-16">
        <span className="material-symbols-outlined text-secondary text-5xl">account_circle</span>
        <p className="mt-3 text-sm text-secondary">Sign in to view your profile.</p>
        <Link
          href="/sign-in"
          className="inline-block mt-4 text-xs font-bold bg-earth-charcoal text-canvas-sandstone px-6 py-2.5 rounded-full shadow-sm"
        >
          Sign in
        </Link>
      </div>
    );
  }

  const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? '—';
  const memberSince = user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const scope = role ? (ROLE_DEPT[role] === 'all' ? 'All departments' : `${ROLE_LABEL[role]} scope`) : 'Demo';
  const accessible = pagesForRole(role);

  return (
    <div className="animate-fadeIn">
      <PageHeader kicker="Account" title="Profile" />

      {/* Identity card */}
      <Card className="!p-5 text-center mb-4 bg-surface-parchment border-earth-border shadow-sm">
        <div className="relative inline-block">
          <Avatar
            src={user.imageUrl}
            name={user.fullName}
            className="w-20 h-20 rounded-full object-cover border-2 border-copper-accent/40 shadow-sm mx-auto"
          />
          <span className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-telemetry-emerald border-2 border-surface-parchment" />
        </div>
        <h2 className="font-['Space_Grotesk'] text-lg font-bold text-earth-charcoal mt-3 truncate">
          {user.fullName ?? user.username ?? email.split('@')[0]}
        </h2>
        <p className="text-xs text-secondary truncate">{email}</p>
        {role && (
          <span className="inline-block mt-2 px-3 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider border-copper-accent/40 bg-copper-accent/10 text-copper-accent">
            {ROLE_LABEL[role as Role] ?? role}
          </span>
        )}
        <div className="flex justify-center mt-3">
          <UserButton />
        </div>
      </Card>

      {/* Details */}
      <Card className="!p-0 overflow-hidden mb-4 bg-surface-parchment border-earth-border shadow-sm">
        {[
          ['Department scope', scope, 'workspaces'],
          ['Member since', memberSince, 'calendar_month'],
          ['Auth provider', 'Clerk (JWT session)', 'verified_user'],
          ['User ID', user.id, 'fingerprint'],
        ].map(([label, value, icon], i) => (
          <div key={label} className={`px-4 py-3 flex items-center gap-3 ${i > 0 ? 'border-t border-earth-border' : ''}`}>
            <span className="material-symbols-outlined !text-[18px] text-secondary">{icon}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[9px] font-bold text-secondary uppercase tracking-wider">{label}</div>
              <div className="text-[11px] text-earth-charcoal font-mono truncate">{value}</div>
            </div>
          </div>
        ))}
      </Card>

      {/* Access */}
      <div className="text-[10px] font-bold text-secondary uppercase tracking-widest mb-2">Your access</div>
      <div className="flex flex-wrap gap-2 mb-5">
        {accessible.map((p) => (
          <Link
            key={p.href}
            href={'/m' + p.href}
            className="px-3 py-1.5 rounded-full bg-surface-container-low border border-earth-border text-xs font-semibold text-secondary hover:text-copper-accent hover:border-copper-accent/40 transition-all flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined !text-[15px]">{p.icon}</span>
            {p.label}
          </Link>
        ))}
        <Link
          href="/m/alerts"
          className="px-3 py-1.5 rounded-full bg-surface-container-low border border-earth-border text-xs font-semibold text-secondary flex items-center gap-1.5"
        >
          <span className="material-symbols-outlined !text-[15px]">notifications_active</span>
          Alerts
        </Link>
        {isSuperAdmin && (
          <Link
            href="/m/admin"
            className="px-3 py-1.5 rounded-full bg-copper-accent/10 border border-copper-accent/40 text-xs font-bold text-copper-accent flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined !text-[15px]">admin_panel_settings</span>
            Manage admins
          </Link>
        )}
      </div>

      <button
        onClick={() => clerk.signOut({ redirectUrl: '/m' })}
        className="w-full py-3 rounded-xl border border-telemetry-crimson/50 text-xs font-bold uppercase tracking-wider text-telemetry-crimson hover:bg-telemetry-crimson/10 transition-all active:scale-[0.98]"
      >
        Sign out
      </button>
    </div>
  );
}
