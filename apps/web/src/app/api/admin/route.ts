/**
 * /api/admin — Super-admin-only admin management over the Clerk Backend API.
 *
 * GET            → all users that carry a publicMetadata.role
 * POST           → create a new admin (email + password) or assign a role to
 *                  an existing email; body: { email, password?, name?, role }
 * DELETE         → strip a user's role; body: { userId }
 *
 * Every call requires the caller to be signed in with
 * publicMetadata.role === 'super_admin'.
 */

// Force dynamic rendering — Clerk initializes at runtime, not build time.
// Without this, `next build` tries to collect page data and crashes when
// NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is not available in the build environment.
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import type { Role } from '@/lib/roles';


const VALID_ROLES: Role[] = [
  'super_admin',
  'production_admin',
  'exploration_admin',
  'equipment_admin',
  'mine_planner',
  'management',
];

async function requireSuperAdmin() {
  const { auth, clerkClient } = await import('@clerk/nextjs/server');
  const { userId } = await auth();
  if (!userId) return { error: NextResponse.json({ error: 'Sign in required' }, { status: 401 }) };
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  if (user.publicMetadata?.role !== 'super_admin') {
    return { error: NextResponse.json({ error: 'Super admin only' }, { status: 403 }) };
  }
  return { client, adminId: userId };
}

export async function GET() {
  const guard = await requireSuperAdmin();
  if (guard.error) return guard.error;
  const client = guard.client!;

  const users = await client.users.getUserList({ limit: 200 });
  const admins = users.data
    .filter((u) => u.publicMetadata?.role)
    .map((u) => ({
      userId: u.id,
      email: u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress
        ?? u.emailAddresses[0]?.emailAddress
        ?? '—',
      name: u.fullName ?? u.username ?? '—',
      role: u.publicMetadata?.role as string,
      createdAt: u.createdAt,
    }))
    .sort((a, b) => (a.role === 'super_admin' ? -1 : 1) - (b.role === 'super_admin' ? -1 : 1));

  return NextResponse.json({ admins, count: admins.length });
}

export async function POST(req: Request) {
  const guard = await requireSuperAdmin();
  if (guard.error) return guard.error;
  const client = guard.client!;

  const body = await req.json().catch(() => null);
  const email: string = String(body?.email ?? '').trim().toLowerCase();
  const role: string = String(body?.role ?? '');
  const password: string | undefined = body?.password ? String(body.password) : undefined;
  const name: string | undefined = body?.name ? String(body.name) : undefined;

  if (!email.includes('@')) return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
  if (!VALID_ROLES.includes(role as Role)) {
    return NextResponse.json({ error: `Role must be one of: ${VALID_ROLES.join(', ')}` }, { status: 400 });
  }
  if (password && password.length < 15) {
    return NextResponse.json({ error: 'Password must be at least 15 characters (Clerk instance policy).' }, { status: 400 });
  }

  // Find existing user by email, else create one.
  const existing = await client.users.getUserList({ emailAddress: [email], limit: 1 });
  let user = existing.data[0];
  let created = false;

  if (user) {
    await client.users.updateUser(user.id, {
      publicMetadata: { ...user.publicMetadata, role },
      ...(name ? { firstName: name.split(' ')[0], lastName: name.split(' ').slice(1).join(' ') || undefined } : {}),
    });
  } else {
    if (!password) {
      return NextResponse.json(
        { error: 'New users need a password (min 15 chars) — they can change it after first sign-in.' },
        { status: 400 }
      );
    }
    const [firstName, ...rest] = (name ?? email.split('@')[0]).split(' ');
    user = await client.users.createUser({
      emailAddress: [email],
      password,
      firstName: firstName || undefined,
      lastName: rest.join(' ') || undefined,
      publicMetadata: { role },
    });
    created = true;
  }

  return NextResponse.json({
    ok: true,
    created,
    admin: {
      userId: user.id,
      email,
      role,
      name: user.fullName ?? email,
    },
  });
}

export async function DELETE(req: Request) {
  const guard = await requireSuperAdmin();
  if (guard.error) return guard.error;
  const client = guard.client!;

  const body = await req.json().catch(() => null);
  const userId: string = String(body?.userId ?? '');
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
  if (userId === guard.adminId) {
    return NextResponse.json({ error: 'You cannot remove your own role.' }, { status: 400 });
  }

  const user = await client.users.getUser(userId);
  await client.users.updateUser(userId, {
    publicMetadata: { ...user.publicMetadata, role: null },
  });
  return NextResponse.json({ ok: true, userId });
}
