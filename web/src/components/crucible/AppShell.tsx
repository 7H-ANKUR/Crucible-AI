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
import { canAccessPage, ROLE_HOME, useCrucibleAuth } from '@/lib/roles';

export const useShellDepartment = () => {
  const { role } = useCrucibleAuth();
  return role?.replace('_admin', '') ?? 'all';
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const [alertCount, setAlertCount] = useState(0);
  const { role, isSignedIn } = useCrucibleAuth();
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
    <div className="bg-canvas-sandstone font-body-md text-body-md text-on-surface antialiased min-h-screen flex flex-col">
      {pathname !== '/' && <SideNavBar alertCount={alertCount} />}
      <div className={pathname !== '/' ? "pl-64 pt-16 flex flex-col min-h-screen bg-canvas-sandstone" : "flex flex-col min-h-screen"}>
        <TopNavBar />
        {children}
      </div>
    </div>
  );
}
