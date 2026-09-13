'use client';

/**
 * Login — Clerk-powered sign-in/up styled to the Crucible AI theme.
 * After signing in, users land on their department's home (set on the user's
 * publicMetadata.role by a super admin).
 */
import React, { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SignIn, useAuth } from '@clerk/nextjs';
import { useTheme } from '@/lib/theme';

export default function LoginPage() {
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { isDark } = useTheme();

  useEffect(() => {
    // The Command Center is the landing surface. This previously sent an
    // already-signed-in visitor to /production, overriding Clerk's own redirect.
    if (isSignedIn) router.replace('/command-center');
  }, [isSignedIn, router]);

  return (
    <main className="min-h-screen bg-[#08151c] flex flex-col items-center justify-center px-4 py-12 relative overflow-hidden">
      {/* ambient glow + grid */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-[#ffbd77]/10 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"></div>

      <div className="relative z-10 w-full max-w-md flex flex-col items-center gap-7">
        <Link href="/" className="flex items-center gap-2 group">
          <span
            className="material-symbols-outlined text-accentt text-4xl group-hover:scale-110 transition-transform"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            landscape
          </span>
          <span className="font-['Space_Grotesk'] text-4xl font-bold text-accentt tracking-tight">Crucible AI</span>
        </Link>

        <div className="text-center">
          <h1 className="font-['Manrope'] text-2xl font-bold text-ink">Operational Cockpit Sign-in</h1>
          <p className="text-sm text-ink2 mt-1">
            Every admin sees only their department. Super admins see it all.
          </p>
        </div>

        <div className="w-full flex justify-center">
          <SignIn
            // The Command Center, not a dashboard: the first thing a manager should see
            // after signing in is whether anything needs their attention.
            fallbackRedirectUrl="/command-center"
            signUpFallbackRedirectUrl="/command-center"
            appearance={{
              variables: {
                colorPrimary: '#f59a23',
                colorBackground: isDark ? '#0b1a22' : '#ffffff',
                colorInputBackground: isDark ? '#14212a' : '#f1f3f5',
                colorInputText: isDark ? '#d7e4ef' : '#182430',
                borderRadius: '0.75rem',
              },
            } as any}
          />
        </div>

        {/* Guests land on the Command Center too — it is the platform's front door. */}
        <Link href="/command-center" className="text-xs font-bold text-ink3 hover:text-accentt transition-colors uppercase tracking-wider">
          Continue as guest →
        </Link>
      </div>
    </main>
  );
}
