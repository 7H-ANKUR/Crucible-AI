'use client';

/**
 * BackendWarmup — mounts the API warm-up watcher for the whole app.
 *
 * Rendered once from the root layout so it runs on every entry route, not just the
 * landing page: a user who deep-links straight to /production should also start the
 * Render cold boot as early as possible.
 *
 * Renders nothing and never blocks. See lib/warmup.ts for the probe strategy.
 */

import { useEffect } from 'react';
import { startWarmupWatcher } from '@/lib/warmup';

export function BackendWarmup() {
  useEffect(() => startWarmupWatcher(), []);
  return null;
}
