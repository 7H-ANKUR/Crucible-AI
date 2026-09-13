'use client';

/**
 * roles.ts — Crucible AI role model + navigation IA.
 *
 * Roles:
 *   super_admin       → sees every department + admin management
 *   production_admin  → production department only
 *   exploration_admin → exploration department only
 *   equipment_admin   → equipment department only
 *   mine_planner      → planning / scenarios
 *   management        → read-only view of every department
 *
 * Navigation is grouped into labelled sections per the IA spec:
 *   OVERVIEW · EXPLORE · OPERATE · PLAN · DECIDE · DATA · TRUST
 */
import { createContext, createElement, useContext, type ReactNode } from 'react';

export type Role =
  | 'super_admin'
  | 'production_admin'
  | 'exploration_admin'
  | 'equipment_admin'
  | 'mine_planner'
  | 'management';

export interface CrucibleAuthState {
  isSignedIn: boolean;
  role: Role | null;
  userId: string | null;
  name: string | null;
}

export const ROLE_DEPT: Record<Role, string> = {
  super_admin:       'all',
  management:        'all',
  production_admin:  'production',
  exploration_admin: 'exploration',
  equipment_admin:   'equipment',
  mine_planner:      'planning',
};

export const ROLE_LABEL: Record<Role, string> = {
  super_admin:       'Super Admin',
  management:        'Management',
  production_admin:  'Production Admin',
  exploration_admin: 'Exploration Admin',
  equipment_admin:   'Equipment Admin',
  mine_planner:      'Mine Planner',
};

export const ROLE_HOME: Record<Role, string> = {
  super_admin:       '/production',
  management:        '/intelligence',
  production_admin:  '/production',
  exploration_admin: '/exploration',
  equipment_admin:   '/equipment',
  mine_planner:      '/scenario',
};

/** Which department a page belongs to (used by canAccessPage). */
export const PAGE_DEPT: Record<string, string> = {
  '/command-center': 'all',
  '/production':   'production',
  '/exploration':  'exploration',
  '/equipment':    'equipment',
  '/scenario':     'planning',
  '/intelligence': 'all',
  '/data-hub':     'all',
  '/governance':   'governance',
  '/lab':          'all',
  '/routing':      'all',
};

// ---------------------------------------------------------------------------
// Navigation IA — grouped sections
// ---------------------------------------------------------------------------

export interface NavPage {
  href: string;
  label: string;
  icon: string;
  dept: string;
  isNew?: boolean;
}

export interface NavGroup {
  label: string;
  pages: readonly NavPage[];
}

/** All navigation groups in display order. */
/**
 * Navigation groups, in display order.
 *
 * Organised around what a manager is trying to do, not around which backend
 * module serves the page. COMMAND CENTER is first and alone because it is the
 * landing surface and answers the question every other page assumes has already
 * been asked: does anything need attention right now?
 *
 * Analytics pages remain, below the decision surfaces rather than above them.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'COMMAND',
    pages: [
      { href: '/command-center', label: 'Command Center', icon: 'emergency_home',      dept: 'all', isNew: true },
    ],
  },
  {
    label: 'OPERATIONS',
    pages: [
      { href: '/production',   label: 'Production',   icon: 'factory',                 dept: 'production' },
      { href: '/equipment',    label: 'Equipment',    icon: 'precision_manufacturing', dept: 'equipment' },
      { href: '/routing',      label: 'Haul Routing', icon: 'route',                   dept: 'all' },
    ],
  },
  {
    label: 'EXPLORE',
    pages: [
      { href: '/exploration',  label: 'Exploration',  icon: 'my_location',             dept: 'exploration' },
    ],
  },
  {
    label: 'DECIDE',
    pages: [
      { href: '/scenario',     label: 'Scenarios',    icon: 'science',                 dept: 'planning' },
      { href: '/intelligence', label: 'Intelligence', icon: 'psychology',              dept: 'all' },
      { href: '/alerts',       label: 'Alerts',       icon: 'notifications_active',    dept: 'all' },
    ],
  },
  {
    label: 'DATA',
    pages: [
      { href: '/data-hub',     label: 'Data Hub',     icon: 'cloud_upload',            dept: 'all' },
      { href: '/lab',          label: 'ML Lab',       icon: 'experiment',              dept: 'all' },
    ],
  },
  {
    label: 'TRUST',
    pages: [
      { href: '/governance',   label: 'Governance',   icon: 'verified_user',           dept: 'governance' },
    ],
  },
] as const;

/** Flat de-duped list of all pages (for topbar + backward compat). */
export const ALL_PAGES: readonly NavPage[] = (() => {
  const seen = new Set<string>();
  const result: NavPage[] = [];
  for (const group of NAV_GROUPS) {
    for (const page of group.pages) {
      if (!seen.has(page.href)) {
        seen.add(page.href);
        result.push(page);
      }
    }
  }
  return result;
})();

// ---------------------------------------------------------------------------
// Auth context
// ---------------------------------------------------------------------------

const DEMO_AUTH: CrucibleAuthState = { isSignedIn: false, role: null, userId: null, name: null };
const AuthCtx = createContext<CrucibleAuthState>(DEMO_AUTH);

export function CrucibleAuthProvider({ value, children }: { value: CrucibleAuthState; children: ReactNode }) {
  return createElement(AuthCtx.Provider, { value }, children);
}

export function useCrucibleAuth(): CrucibleAuthState & { isSuperAdmin: boolean } {
  const state = useContext(AuthCtx);
  return { ...state, isSuperAdmin: state.role === 'super_admin' };
}

// ---------------------------------------------------------------------------
// Role-filtered nav helpers
// ---------------------------------------------------------------------------

function _pageVisible(page: NavPage, role: Role | null): boolean {
  if (!role || role === 'super_admin' || role === 'management') return true;
  if (page.dept === 'all') return true;
  return page.dept === ROLE_DEPT[role];
}

/** Groups filtered to what this role may see. Empty groups are omitted. */
export function groupsForRole(role: Role | null): NavGroup[] {
  return NAV_GROUPS
    .map((group) => ({ ...group, pages: group.pages.filter((p) => _pageVisible(p, role)) }))
    .filter((group) => group.pages.length > 0);
}

/** Flat list of visible pages for a role (for topbar + mobile drawer). */
export function pagesForRole(role: Role | null): NavPage[] {
  const seen = new Set<string>();
  const result: NavPage[] = [];
  for (const group of groupsForRole(role)) {
    for (const page of group.pages) {
      if (!seen.has(page.href)) {
        seen.add(page.href);
        result.push(page);
      }
    }
  }
  return result;
}

/** Can this role open this path? Signed-out (demo) users may browse everything.
 *  Mobile /m/* paths map onto the same department rules. */
export function canAccessPage(role: Role | null, pathname: string): boolean {
  if (!role) return true;
  if (role === 'super_admin' || role === 'management') return true;
  const path = pathname.replace(/^\/m(?=\/|$)/, '') || '/';
  if (path.startsWith('/admin')) return false;
  if (path.startsWith('/command-center') || path.startsWith('/alerts') || path.startsWith('/intelligence') || path.startsWith('/data-hub') || path.startsWith('/lab') || path.startsWith('/routing')) return true;
  const dept = Object.entries(PAGE_DEPT).find(([prefix]) => path.startsWith(prefix))?.[1];
  if (!dept || dept === 'all') return true;
  return dept === ROLE_DEPT[role];
}
