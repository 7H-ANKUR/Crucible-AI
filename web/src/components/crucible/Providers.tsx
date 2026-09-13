'use client';

/**
 * Providers — Clerk auth wired into the Crucible AI role model.
 * - ClerkThemed: ClerkProvider with theme-reactive appearance.
 * - RoleBridge: exposes publicMetadata.role through CrucibleAuthProvider.
 */
import React from 'react';
import { ClerkProvider, useUser } from '@clerk/nextjs';
import { CrucibleAuthProvider, type Role } from '@/lib/roles';
import { useTheme } from '@/lib/theme';

function ClerkThemed({ children }: { children: React.ReactNode }) {
  const { isDark } = useTheme();
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: '#f59a23',
          colorBackground: isDark ? '#0b1a22' : '#ffffff',
          colorInputBackground: isDark ? '#14212a' : '#f1f3f5',
          colorInputText: isDark ? '#d7e4ef' : '#182430',
          borderRadius: '0.75rem',
          fontFamily: 'Inter, sans-serif',
        },
      } as any}
    >
      <RoleBridge>{children}</RoleBridge>
    </ClerkProvider>
  );
}

import { useAuth } from '@clerk/nextjs';
import { setToken, clearToken } from '@/lib/api';

function RoleBridge({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const { getToken } = useAuth();
  const role = (user?.publicMetadata?.role as Role) ?? null;

  React.useEffect(() => {
    if (isSignedIn) {
      getToken().then((token) => {
        if (token) setToken(token);
      }).catch(() => {});
    } else if (isLoaded && !isSignedIn) {
      clearToken();
    }
  }, [isSignedIn, isLoaded, getToken]);

  return (
    <CrucibleAuthProvider
      value={{
        isSignedIn: Boolean(isLoaded && isSignedIn),
        role,
        userId: user?.id ?? null,
        name: user?.fullName ?? user?.username ?? null,
      }}
    >
      {children}
    </CrucibleAuthProvider>
  );
}

import { SmoothScroll } from '@/components/crucible/SmoothScroll';

export function CrucibleProviders({ children }: { children: React.ReactNode }) {
  return (
    <ClerkThemed>
      <SmoothScroll>{children}</SmoothScroll>
    </ClerkThemed>
  );
}
