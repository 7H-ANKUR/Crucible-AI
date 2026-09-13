/**
 * scripts/create-superadmins.mjs — Bootstrap the first super admins.
 * Creates the users (or upgrades them if the email already exists) and sets
 * publicMetadata.role = 'super_admin'.
 *
 * Run from apps/web:  node scripts/create-superadmins.mjs
 */
import { createClerkClient } from '@clerk/backend';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(join(here, '..', '.env.local'), 'utf8');
const secretKey = env.match(/CLERK_SECRET_KEY=(\S+)/)?.[1];
if (!secretKey) {
  console.error('CLERK_SECRET_KEY not found in apps/web/.env.local');
  process.exit(1);
}

const clerk = createClerkClient({ secretKey });

const SUPER_ADMINS = [
  { email: 'superadmin02@minex.in', password: 'SuperMinEx#2026', name: 'MINEx Super Admin 02', username: 'superadmin02' },
  { email: 'superadmin@minex.in', password: 'SuperMinEx#2026', name: 'MINEx Super Admin' },
];

for (const { email, password, name } of SUPER_ADMINS) {
  try {
    const existing = await clerk.users.getUserList({ emailAddress: [email], limit: 1 });
    const [firstName, ...rest] = name.split(' ');
    if (existing.data.length) {
      const u = existing.data[0];
      await clerk.users.updateUser(u.id, {
        publicMetadata: { ...u.publicMetadata, role: 'super_admin' },
        firstName,
        lastName: rest.join(' ') || undefined,
      });
      console.log(`upgraded existing user -> ${email} (super_admin)`);
    } else {
      await clerk.users.createUser({
        emailAddress: [email],
        password,
        username: email.split('@')[0],
        firstName,
        lastName: rest.join(' ') || undefined,
        publicMetadata: { role: 'super_admin' },
      });
      console.log(`created super admin -> ${email}  password: ${password}`);
    }
  } catch (e) {
    console.error(`FAILED ${email}:`, e?.errors?.[0]?.message ?? e?.message ?? e);
  }
}
console.log('Done.');
