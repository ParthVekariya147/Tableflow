// One-shot Mumbai cutover copier (see api-reference/MUMBAI-CUTOVER.md).
//
// Copies the OLD Supabase project → the NEW one:
//   1. every table, FK-dependency order, via two Prisma clients
//   2. the menu-images storage bucket (object-for-object, same paths)
//   3. rewrites the old project host inside MenuItem.imageUrl + Tenant.theme
//   4. re-creates the super-admin auth user on the NEW project and re-links
//      User.supabaseId (auth user ids do NOT survive project moves)
//   5. verifies row counts old vs new
//
// The NEW database must already have the schema (run `prisma migrate deploy`
// against it first) and be EMPTY — the script refuses to write into a
// non-empty target. Reads config from env vars only:
//   OLD_DB_URL, NEW_DB_URL            (direct 5432 URLs, password %-encoded)
//   OLD_SUPABASE_URL, OLD_SERVICE_KEY
//   NEW_SUPABASE_URL, NEW_SERVICE_KEY
//   SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD   (auth re-create on NEW)
//
// Usage: node tools/mumbai-cutover.mjs [--verify-only]

import { PrismaClient } from "@prisma/client";

const need = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`missing env ${k}`); process.exit(1); }
  return v;
};
const OLD_DB = need("OLD_DB_URL");
const NEW_DB = need("NEW_DB_URL");
const OLD_URL = need("OLD_SUPABASE_URL");
const OLD_KEY = need("OLD_SERVICE_KEY");
const NEW_URL = need("NEW_SUPABASE_URL");
const NEW_KEY = need("NEW_SERVICE_KEY");
const VERIFY_ONLY = process.argv.includes("--verify-only");

const oldDb = new PrismaClient({ datasourceUrl: OLD_DB });
const newDb = new PrismaClient({ datasourceUrl: NEW_DB });
const oldHost = new URL(OLD_URL).host;
const newHost = new URL(NEW_URL).host;

// FK-dependency order (parents first). Children of a table appear after it.
const TABLES = [
  "tenant", "user", "role", "membership",
  "room", "table",
  "menuCategory", "menuItem", "modifierGroup", "modifierOption", "menuPlacement",
  "loyaltyAccount",
  "order", "round", "orderItem", "orderItemModifier",
  "payment", "review", "serviceRequest", "loyaltyTransaction",
  "plan", "subscription", "auditLog",
];

async function counts(db) {
  const out = {};
  for (const t of TABLES) out[t] = await db[t].count().catch(() => "n/a");
  return out;
}

async function copyTables() {
  const target = await newDb.tenant.count();
  if (target > 0) { console.error(`REFUSING: target already has ${target} tenants`); process.exit(1); }
  for (const t of TABLES) {
    const rows = await oldDb[t].findMany().catch(() => null);
    if (!rows) { console.log(`${t}: n/a on source, skipped`); continue; }
    if (rows.length === 0) { console.log(`${t}: 0`); continue; }
    await newDb[t].createMany({ data: rows, skipDuplicates: true });
    console.log(`${t}: ${rows.length} copied`);
  }
}

async function copyStorage() {
  const H_OLD = { apikey: OLD_KEY, Authorization: `Bearer ${OLD_KEY}` };
  const H_NEW = { apikey: NEW_KEY, Authorization: `Bearer ${NEW_KEY}` };
  // ensure bucket on NEW (public read, same as StorageService bootstraps)
  await fetch(`${NEW_URL}/storage/v1/bucket`, {
    method: "POST", headers: { ...H_NEW, "Content-Type": "application/json" },
    body: JSON.stringify({ id: "menu-images", name: "menu-images", public: true }),
  }); // 409 if it exists — fine
  const list = (prefix) =>
    fetch(`${OLD_URL}/storage/v1/object/list/menu-images`, {
      method: "POST", headers: { ...H_OLD, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
    }).then((r) => r.json());
  const top = await list("");
  let copied = 0;
  for (const entry of top) {
    const files = entry.id ? [entry] : (await list(entry.name + "/")).map((f) => ({ ...f, name: `${entry.name}/${f.name}` }));
    for (const f of files) {
      if (!f.id) continue; // nested folder — bucket layout is <tenantId>/<file>, one level
      const blob = await fetch(`${OLD_URL}/storage/v1/object/menu-images/${f.name}`, { headers: H_OLD }).then((r) => r.arrayBuffer());
      const up = await fetch(`${NEW_URL}/storage/v1/object/menu-images/${f.name}`, {
        method: "POST",
        headers: { ...H_NEW, "Content-Type": f.metadata?.mimetype ?? "application/octet-stream", "x-upsert": "true" },
        body: Buffer.from(blob),
      });
      if (!up.ok) console.error(`  upload FAILED ${f.name}: ${up.status} ${await up.text()}`);
      else copied++;
    }
  }
  console.log(`storage: ${copied} objects copied`);
}

async function rewriteUrls() {
  const items = await newDb.menuItem.findMany({ where: { imageUrl: { contains: oldHost } }, select: { id: true, imageUrl: true } });
  for (const i of items)
    await newDb.menuItem.update({ where: { id: i.id }, data: { imageUrl: i.imageUrl.replaceAll(oldHost, newHost) } });
  console.log(`imageUrl rewrites: ${items.length}`);
  const tenants = await newDb.tenant.findMany();
  let themed = 0;
  for (const t of tenants) {
    const json = JSON.stringify(t.theme ?? null);
    if (json && json.includes(oldHost)) {
      await newDb.tenant.update({ where: { id: t.id }, data: { theme: JSON.parse(json.replaceAll(oldHost, newHost)) } });
      themed++;
    }
  }
  console.log(`tenant.theme rewrites: ${themed}`);
}

async function relinkAuth() {
  const email = need("SUPER_ADMIN_EMAIL");
  const password = need("SUPER_ADMIN_PASSWORD");
  const H = { apikey: NEW_KEY, Authorization: `Bearer ${NEW_KEY}`, "Content-Type": "application/json" };
  const res = await fetch(`${NEW_URL}/auth/v1/admin/users`, {
    method: "POST", headers: H,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await res.json();
  let supabaseId = body?.id;
  if (!supabaseId) {
    // already exists → look it up
    const users = await fetch(`${NEW_URL}/auth/v1/admin/users?per_page=100`, { headers: H }).then((r) => r.json());
    supabaseId = (users.users ?? []).find((u) => u.email === email)?.id;
  }
  if (!supabaseId) { console.error("could not create/find auth user on NEW project"); process.exit(1); }
  const upd = await newDb.user.updateMany({ where: { email }, data: { supabaseId } });
  console.log(`auth: ${email} on NEW project (${supabaseId}); relinked ${upd.count} User row(s)`);
}

async function main() {
  console.log(`old=${oldHost}  new=${newHost}  verifyOnly=${VERIFY_ONLY}`);
  if (!VERIFY_ONLY) {
    await copyTables();
    await copyStorage();
    await rewriteUrls();
    await relinkAuth();
  }
  const [a, b] = await Promise.all([counts(oldDb), counts(newDb)]);
  let bad = 0;
  for (const t of TABLES) {
    const ok = a[t] === b[t];
    if (!ok) bad++;
    console.log(`${ok ? "  " : "!!"} ${t}: old=${a[t]} new=${b[t]}`);
  }
  console.log(bad === 0 ? "VERIFY OK — counts match" : `VERIFY FAILED — ${bad} table(s) differ`);
  process.exitCode = bad === 0 ? 0 : 1;
}

main().finally(async () => { await oldDb.$disconnect(); await newDb.$disconnect(); });
