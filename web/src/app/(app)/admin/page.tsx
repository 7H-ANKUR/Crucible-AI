'use client';

/**
 * /admin — Super-admin console: see every admin, create more admins by
 * email, and demote users. Guarded twice: client-side by role, server-side
 * by /api/admin.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useCrucibleAuth } from '@/lib/roles';
import { EngineStatusPanel, EngineAuditPanel, EngineIntegrityPanel } from '@/components/crucible/EnginePanel';
import { ROLE_LABEL, type Role } from '@/lib/roles';

const ASSIGNABLE_ROLES: Role[] = [
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

export default function AdminPage() {
  const { isSuperAdmin, isSignedIn } = useCrucibleAuth();
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', name: '', role: 'production_admin', password: '' });

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin');
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Failed to load admins');
      setAdmins(j.admins ?? []);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load admins');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSuperAdmin) load();
    else setLoading(false);
  }, [isSuperAdmin, load]);

  const createAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Failed to create admin');
      showToast(`${form.email} is now ${ROLE_LABEL[form.role as Role]}${j.created ? ' (account created)' : ' (existing user assigned)'}`);
      setForm({ email: '', name: '', role: form.role, password: '' });
      load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create admin');
    }
  };

  const demote = async (userId: string, email: string) => {
    if (!window.confirm(`Remove admin role from ${email}?`)) return;
    try {
      const r = await fetch('/api/admin', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? 'Failed');
      showToast(`${email} demoted to standard user`);
      load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to demote');
    }
  };

  if (!isSignedIn) {
    return (
      <main className="flex-1 bg-deep min-h-screen p-8 grid place-items-center">
        <div className="text-center">
          <span className="material-symbols-outlined text-ink3 text-5xl">lock</span>
          <p className="mt-3 text-sm text-ink2">Sign in as a super admin to manage admins.</p>
        </div>
      </main>
    );
  }

  if (!isSuperAdmin) {
    return (
      <main className="flex-1 bg-deep min-h-screen p-8 grid place-items-center">
        <div className="text-center">
          <span className="material-symbols-outlined text-dangert text-5xl">gpp_bad</span>
          <p className="mt-3 text-sm text-ink2">Super admin access only.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 bg-deep min-h-screen p-4 md:p-6 lg:p-8 pb-16">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-accent text-onaccent px-4 py-2.5 rounded-xl shadow-2xl text-xs font-bold flex items-center gap-2 animate-bounce">
          <span className="material-symbols-outlined text-base">check_circle</span>
          <span>{toast}</span>
        </div>
      )}

      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-bold text-ink3 tracking-widest uppercase">Platform</span>
          <span className="text-ink3">/</span>
          <span className="text-[11px] font-bold text-accentt tracking-widest uppercase">Admins</span>
        </div>
        <h1 className="font-['Manrope'] text-3xl md:text-4xl font-bold text-ink tracking-tight">Admin Management</h1>
        <p className="text-sm text-ink2 mt-1 max-w-2xl">
          Create department admins as needed. Department admins see only their department&apos;s problems and analysis; super admins see everything.
        </p>
      </header>

      {error && (
        <div className="mb-4 max-w-2xl text-xs text-warnt bg-warn/10 border border-warn/40 rounded-xl px-4 py-2.5">{error}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Create form */}
        <section className="xl:col-span-1">
          <form onSubmit={createAdmin} className="glass-panel p-6 border border-frost/10 flex flex-col gap-4">
            <h3 className="font-['Manrope'] text-lg font-bold text-accentt flex items-center gap-2">
              <span className="material-symbols-outlined">person_add</span>
              Create / Assign Admin
            </h3>

            <div>
              <label className="text-[11px] font-bold text-ink2 uppercase tracking-wider block mb-1">Email</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="admin@crucible.in"
                className="w-full bg-deep2 border border-line rounded-xl px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-ink2 uppercase tracking-wider block mb-1">Display name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Sunita Ops"
                className="w-full bg-deep2 border border-line rounded-xl px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="text-[11px] font-bold text-ink2 uppercase tracking-wider block mb-1">Role</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full bg-deep2 border border-line rounded-xl px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-accent"
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
              <p className="text-[10px] text-ink3 mt-1.5">
                {form.role === 'super_admin'
                  ? 'Sees every department and can create more admins.'
                  : `Sees only the ${form.role.replace('_admin', '').replace('mine_planner', 'planning')} department.`}
              </p>
            </div>

            <div>
              <label className="text-[11px] font-bold text-ink2 uppercase tracking-wider block mb-1">
                Password <span className="text-ink3 normal-case">(new accounts)</span>
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Min 8 characters"
                className="w-full bg-deep2 border border-line rounded-xl px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-accent"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-accent text-onaccent text-xs font-bold uppercase tracking-wider rounded-xl hover:bg-accent2 transition-all flex items-center justify-center gap-2 shadow-lg"
            >
              <span className="material-symbols-outlined text-sm">person_add</span>
              Save admin
            </button>
          </form>
        </section>

        {/* Admin list */}
        <section className="xl:col-span-2">
          <div className="rounded-[24px] bg-deep2 border border-line p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink flex items-center gap-2">
                <span className="material-symbols-outlined text-inkb" style={{ fontVariationSettings: "'FILL' 1" }}>admin_panel_settings</span>
                Current admins
                <span className="text-[11px] text-ink3 font-normal">({admins.length})</span>
              </h3>
              <button onClick={load} className="text-[11px] font-bold text-inkb hover:text-ink uppercase tracking-wider">Refresh</button>
            </div>

            {loading ? (
              <p className="text-sm text-ink3 py-6 text-center">Loading admins…</p>
            ) : !admins.length ? (
              <p className="text-sm text-ink3 py-6 text-center">
                No admins assigned yet — create the first one (or run the super-admin bootstrap script).
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-line">
                      {['Admin', 'Email', 'Role', 'Scope', ''].map((h) => (
                        <th key={h} className="py-2.5 px-3 text-[10px] text-ink3 uppercase tracking-widest">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="text-[13px] divide-y divide-line/50">
                    {admins.map((a) => (
                      <tr key={a.userId} className="hover:bg-panel4/30 transition-colors">
                        <td className="py-3 px-3 font-medium text-ink">{a.name}</td>
                        <td className="py-3 px-3 text-inkb font-mono text-xs">{a.email}</td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${
                              a.role === 'super_admin'
                                ? 'bg-accent/15 text-accentt border-accent/40'
                                : 'bg-chipon/40 text-inkb border-chipon'
                            }`}
                          >
                            {ROLE_LABEL[a.role as Role] ?? a.role}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-ink2 text-xs">
                          {a.role === 'super_admin' || a.role === 'management' ? 'All departments' : `${a.role.replace('_admin', '').replace('mine_planner', 'planning')} only`}
                        </td>
                        <td className="py-3 px-3 text-right">
                          {a.role !== 'super_admin' && (
                            <button
                              onClick={() => demote(a.userId, a.email)}
                              className="text-[11px] font-bold text-dangert hover:underline"
                            >
                              Demote
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ML engine — platform health for the Crucible AI service behind the Lab. */}
      <section className="mt-8">
        <div className="flex items-baseline gap-3 mb-4">
          <h2 className="font-['Manrope'] text-xl font-bold text-ink tracking-tight">ML Engine</h2>
          <span className="text-xs text-ink3">
            Internal service on loopback — powers the ML Lab
          </span>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <EngineStatusPanel />
          <EngineIntegrityPanel />
          <EngineAuditPanel />
        </div>
      </section>
    </main>
  );
}
