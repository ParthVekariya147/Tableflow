/**
 * Standalone, non-destructive seed: ensures exactly one platform super-admin
 * exists (real Supabase Auth user + matching Prisma `User` row,
 * `isSuperAdmin: true`) so there's a working super-admin login.
 *
 * Unlike `seed.ts` (which wipes and recreates *all* tenant data on every
 * run), this script only upserts the super-admin — safe to run against a
 * database that already has real tenants/orders you don't want touched.
 *
 * Reads the same env vars as the main seed (`services/api/.env`):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPER_ADMIN_SEED_EMAIL
 *   (default "ops@amber.platform"), SUPER_ADMIN_SEED_PASSWORD (required).
 */
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const prisma = new PrismaClient();

async function ensureSupabaseUser(email: string, password: string): Promise<string> {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set in services/api/.env — " +
        "required to create a real super-admin login.",
    );
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: existing, error: listError } = await admin.auth.admin.listUsers();
  if (listError) {
    throw new Error(`Failed to list Supabase users: ${listError.message}`);
  }

  const found = existing.users.find((u) => u.email === email);
  if (found) {
    // Keep the password in sync with .env so a rotated SUPER_ADMIN_SEED_PASSWORD
    // actually takes effect on a re-run, instead of silently reusing the old one.
    const { error: updateError } = await admin.auth.admin.updateUserById(found.id, {
      password,
    });
    if (updateError) {
      throw new Error(`Failed to update super-admin password: ${updateError.message}`);
    }
    return found.id;
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    throw new Error(`Failed to create Supabase super-admin user: ${createError?.message}`);
  }
  return created.user.id;
}

async function main() {
  const email = process.env.SUPER_ADMIN_SEED_EMAIL ?? "ops@amber.platform";
  const password = process.env.SUPER_ADMIN_SEED_PASSWORD;
  if (!password) {
    throw new Error(
      "SUPER_ADMIN_SEED_PASSWORD is not set in services/api/.env — refusing to seed " +
        "a super-admin without a real password.",
    );
  }

  const supabaseId = await ensureSupabaseUser(email, password);

  const user = await prisma.user.upsert({
    where: { supabaseId },
    update: { email, isSuperAdmin: true },
    create: { email, name: "Platform Ops", supabaseId, isSuperAdmin: true },
  });

  console.log(`✅ Super-admin ready: ${user.email} (User.id=${user.id})`);
  console.log(`   Log in at apps/super-admin with email "${email}" and the configured password.`);
}

main()
  .catch((err) => {
    console.error("❌ Failed to seed super-admin:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
