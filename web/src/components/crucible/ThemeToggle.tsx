'use client';

/**
 * ThemeToggle — sun/moon switch. Light is default; dark restores the
 * original Stitch palette. Persists via lib/theme (localStorage).
 */
import React from 'react';
import { useTheme } from '@/lib/theme';

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { toggle, isDark } = useTheme();
  return (
    <button
      onClick={toggle}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={`grid place-items-center rounded-full text-ink2 hover:text-accentt hover:bg-panel4/50 transition-colors ${
        compact ? 'h-8 w-8' : 'h-9 w-9'
      }`}
    >
      <span className="material-symbols-outlined !text-[20px]">
        {isDark ? 'light_mode' : 'dark_mode'}
      </span>
    </button>
  );
}
