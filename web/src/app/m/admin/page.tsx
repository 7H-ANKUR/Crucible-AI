'use client';

/**
 * m/admin — super-admin console (compact): admin list + create/assign form.
 * Reskinned to Earthy Industrial.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useCrucibleAuth, ROLE_LABEL, type Role } from '@/lib/roles';
import { Card, PageHeader } from '@/components/mobile/ui';

const ASSIGNABLE: Role[] = [
  'super_admin',
  'production_admin',
  'exploration_admin',
  'equipment_admin',
  'mine_planner',
  'management',
];

interface AdminRow {
  userId: string;
  email: string;
  name: string;
  role: string;
}

export default function MobileAdmin() {
  const { isSuperAdmin, isSignedIn } = useCrucibleAuth();
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', name: '', role: 'production_admin', password: '' });

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin');
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Failed');
      setAdmins(j.admins ?? []);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    }
  }, []);

  useEffect(() => {
    if (isSuperAdmin) load();
  }, [isSuperAdmin, load]);

  const create = async () => {
    try {
      const r = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Failed');
      setToast(`${form.email} → ${ROLE_LABEL[form.role as Role]}`);
      setForm({ ...form, email: '', name: '', password: '' });
      load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed');
    }
    setTimeout(() => setToast(null), 2500);
  };

  if (!isSignedIn || !isSuperAdmin) {
    return (
      <div className="grid place-items-center py-20">
        <span className="material-symbols-outlined text-telemetry-crimson text-4xl">gpp_bad</span>
        <p className="mt-2 text-sm text-secondary">Super admin access only.</p>
      </div>
    );
  }

  return (
    <div className="animate-fadeIn">
      <PageHeader kicker="Platform" title="Admins" subtitle="Create department admins as needed" />

      {error && (
        <div className="mb-3 text-xs text-telemetry-amber bg-telemetry-amber/10 border border-telemetry-amber/40 rounded-xl px-3 py-2">{error}</div>
      )}

      <Card className="mb-4 bg-surface-parchment border-earth-border shadow-sm">
        <div className="flex flex-col gap-2.5">
          <input
            type="email"
            placeholder="admin@crucible.in"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="w-full bg-surface-container-low border border-earth-border rounded-xl px-3.5 py-2.5 text-xs text-earth-charcoal focus:outline-none focus:border-copper-accent transition-colors"
          />
          <input
            type="text"
            placeholder="Display name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full bg-surface-container-low border border-earth-border rounded-xl px-3.5 py-2.5 text-xs text-earth-charcoal focus:outline-none focus:border-copper-accent transition-colors"
          />
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            className="w-full bg-surface-container-low border border-earth-border rounded-xl px-3.5 py-2.5 text-xs text-earth-charcoal focus:outline-none focus:border-copper-accent transition-colors"
          >
            {ASSIGNABLE.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <input
            type="password"
            placeholder="Password (new accounts, 15+ chars)"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="w-full bg-surface-container-low border border-earth-border rounded-xl px-3.5 py-2.5 text-xs text-earth-charcoal focus:outline-none focus:border-copper-accent transition-colors"
          />
          <button
            onClick={create}
            className="w-full py-2.5 bg-earth-charcoal text-canvas-sandstone text-xs font-bold uppercase rounded-xl active:scale-95 transition-transform shadow-sm hover:bg-earth-espresso"
          >
            Save admin
          </button>
        </div>
      </Card>

      <div className="text-[10px] font-bold text-secondary uppercase tracking-widest mb-2">Current admins ({admins.length})</div>
      <div className="flex flex-col gap-2.5">
        {admins.map((a) => (
          <Card key={a.userId} className="!p-3.5 bg-surface-parchment border-earth-border shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-bold text-earth-charcoal">{a.name}</div>
                <div className="text-[10px] text-secondary font-mono truncate">{a.email}</div>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase shrink-0 ${
                  a.role === 'super_admin'
                    ? 'bg-copper-accent/15 text-copper-accent border-copper-accent/40'
                    : 'bg-surface-container text-secondary border-earth-border'
                }`}
              >
                {ROLE_LABEL[a.role as Role] ?? a.role}
              </span>
            </div>
          </Card>
        ))}
        {!admins.length && (
          <Card className="text-center text-xs text-secondary bg-surface-parchment border-earth-border shadow-sm">
            No admins loaded — create the first one above.
          </Card>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-[76px] left-1/2 -translate-x-1/2 z-50 bg-copper-accent text-canvas-sandstone px-4 py-2 rounded-xl text-xs font-bold shadow-lg animate-fadeIn">
          {toast}
        </div>
      )}
    </div>
  );
}
