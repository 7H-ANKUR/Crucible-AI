'use client';

/**
 * /command-center — the first screen after login.
 *
 * Information hierarchy, top to bottom, matching the backend payload:
 *
 *   1. Operational state       does the mine need me right now?
 *   2. Attention required      what first?
 *   3. Recommended actions     what do I do about it?
 *   4. If nothing is done      what does waiting cost?
 *   5. Material flow           what is limiting production?
 *
 * Charts and KPI tiles are deliberately absent from the top of this page. A
 * manager opening Crucible AI during a difficult shift needs a decision, not a
 * dashboard; supporting detail lives on the pages linked from each signal.
 */
import React, { useEffect, useState } from 'react';
import { AttentionItem, useCommandSummary, useMines } from '@/lib/command';
import { Caveat, Panel, PanelSkeleton, Skeleton } from '@/components/command/primitives';
import {
  AttentionQueue,
  DoNothingPanel,
  MaterialFlow,
  MineContextBar,
  OperationalStateBanner,
  PitAerialCard,
  RecommendationList,
} from '@/components/command/sections';
import { ResponsePlanDrawer } from '@/components/command/ResponsePlanDrawer';

const MINE_KEY = 'crucible.command.mine';

export default function CommandCenterPage() {
  const { mines, loading: minesLoading } = useMines();
  const [mineId, setMineId] = useState<string | null>(null);
  const [selected, setSelected] = useState<AttentionItem | null>(null);

  // Restore the last mine, but only if the account can still reach it —
  // authorisation may have changed since it was stored.
  useEffect(() => {
    if (mineId || mines.length === 0) return;
    let remembered: string | null = null;
    try {
      remembered = window.localStorage.getItem(MINE_KEY);
    } catch {
      /* private browsing, blocked storage — fall through to the first mine */
    }
    const valid = remembered && mines.some((m) => m.mine_id === remembered);
    setMineId(valid ? remembered : mines[0].mine_id);
  }, [mines, mineId]);

  function selectMine(next: string) {
    setMineId(next);
    setSelected(null);
    try {
      window.localStorage.setItem(MINE_KEY, next);
    } catch {
      /* a remembered selection is a convenience, not state worth failing over */
    }
  }

  const { data, loading, error, reload } = useCommandSummary(mineId);
  const [refreshing, setRefreshing] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }

  if (minesLoading || (!data && loading)) {
    return (
      <main className="w-full pt-16 flex-1 px-4 py-5 space-y-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-32 w-full" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Panel title="Attention required">
              <PanelSkeleton rows={3} />
            </Panel>
          </div>
          <Panel title="If nothing is done">
            <PanelSkeleton rows={4} />
          </Panel>
        </div>
      </main>
    );
  }

  if (mines.length === 0) {
    return (
      <main className="w-full pt-16 flex-1 px-4 py-10">
        <Caveat tone="warn" icon="lock">
          This account is not authorised for any mine. Mine access is granted in Clerk
          <code className="mx-1 rounded bg-surface-container-high px-1 text-earth-charcoal font-semibold">publicMetadata.allowed_mines</code>.
        </Caveat>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="w-full pt-16 flex-1 px-4 py-10 space-y-3">
        <Caveat tone="warn" icon="error">
          {error}
        </Caveat>
        <button
          onClick={onRefresh}
          className="rounded bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-primary-container hover:text-on-primary-container transition-colors"
        >
          Try again
        </button>
      </main>
    );
  }

  if (!data) return null;

  return (
    <main className="w-full flex-1 bg-canvas-sandstone">
      <div className="flex flex-col w-full min-w-0 pb-16">
      <MineContextBar summary={data} mines={mines} onSelect={selectMine} />

      {/* 1. Does the mine need me? */}
      <OperationalStateBanner summary={data} onRefresh={onRefresh} refreshing={refreshing} />

      <div className="px-gutter-lg py-space-lg grid grid-cols-1 xl:grid-cols-12 gap-space-lg">
        <div className="flex flex-col gap-space-lg xl:col-span-7">
          {/* 2. What first? */}
          <AttentionQueue
            items={data.attention.items}
            suppressed={data.attention.suppressed}
            knowledgeGaps={data.attention.knowledge_gaps}
            onInvestigate={setSelected}
          />

          {/* 3. What do I do? */}
          <RecommendationList
            recommendations={data.recommendations.recommendations}
            blocked={data.recommendations.blocked}
            note={data.recommendations.note}
            failed={data.recommendations.failed}
          />

          {/* Pit Aerial Orthomosaic — Stitch Section */}
          <PitAerialCard />
        </div>

        <div className="flex flex-col gap-space-lg xl:col-span-5">
          {/* 4. What does waiting cost? */}
          <DoNothingPanel projection={data.do_nothing} />

          {/* 5. What is limiting production? */}
          <MaterialFlow stages={data.stages} bottleneck={data.bottleneck} />
        </div>
      </div>

      {data.clock.caveat && (
        <Caveat icon="science">
          {data.clock.caveat} Figures describe that period and are not a live feed.
        </Caveat>
      )}

      <p className="pb-4 text-center text-[10px] text-on-surface-variant">
        Crucible AI supports decisions made by authorised mine personnel. It does not perform
        operational actions. Evaluated {new Date(data.evaluated_at).toLocaleString('en-IN')}.
      </p>

      <ResponsePlanDrawer
        mineId={data.mine.mine_id}
        item={selected}
        onClose={() => setSelected(null)}
      />
      </div>
    </main>
  );
}
