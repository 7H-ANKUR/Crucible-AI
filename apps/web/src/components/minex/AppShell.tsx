'use client';

/**
 * AppShell — minimal operational chrome: slim topbar, department sidebar,
 * alerts badge, and a role guard that keeps each admin in their department.
 */
import React, { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { SideNavBar, TopNavBar } from './Navigation';
import { apiFetch } from '@/lib/api';
import { canAccessPage, ROLE_HOME, useMinexAuth } from '@/lib/roles';

export const useShellDepartment = () => {
  const { role } = useMinexAuth();
  return role?.replace('_admin', '') ?? 'all';
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const [alertCount, setAlertCount] = useState(0);
  const { role, isSignedIn } = useMinexAuth();
  const { getToken } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  // Role guard: a department admin trying to open another department's page
  // is sent to their own home. Signed-out (demo) users may browse freely.
  useEffect(() => {
    if (isSignedIn && role && !canAccessPage(role, pathname)) {
      router.replace(ROLE_HOME[role] ?? '/production');
    }
  }, [isSignedIn, role, pathname, router]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = await getToken();
        const alerts = await apiFetch<any>('/alerts', {}, token);
        const rows: any[] = Array.isArray(alerts) ? alerts : alerts?.alerts ?? [];
        if (alive) setAlertCount(rows.filter((a) => !a.acknowledged).length);
      } catch {
        /* badge stays hidden */
      }
    })();
    return () => {
      alive = false;
    };
  }, [getToken]);

  return (
    <div className="min-h-screen flex flex-col bg-page text-ink">
      <TopNavBar unreadAlertCount={alertCount} />
      <div className="flex-1 flex relative">
        <SideNavBar alertCount={alertCount} />
        <div className="flex-1 flex flex-col min-w-0 transition-all duration-300 md:pl-[68px]">{children}</div>
      </div>
    </div>
  );
}
