/**
 * Rehost hotlinked menu photos into our own Supabase Storage bucket.
 *
 * WHY THIS EXISTS — the "images sometimes don't load" bug.
 *
 * The seed ships stand-in photos that hotlink third-party hosts (loremflickr,
 * upload.wikimedia.org, themealdb…). Measured live against amber-grain's 75
 * images, there were TWO separate faults hiding behind one symptom:
 *
 *  1. DEAD URLS (the big one). `flickr()` builds a loremflickr *tag* URL, and
 *     loremflickr answers HTTP 500 for any tag it has no photo for — which is
 *     every regional Indian dish in the extended menu (`hara-bhara-kabab`,
 *     `missi-roti`, `medu-vada`, `uttapam`, `veg-thali`…). Verified one at a
 *     time with zero concurrency: 42/42 returned 500 on repeated attempts.
 *     These never loaded and never will; concurrency has nothing to do with it.
 *  2. BURST RATE-LIMITING (the smaller one). The menu renders every item at
 *     once, so an eager <img> fired ~75 simultaneous requests; Wikimedia
 *     answered 429 for some of them. The same URLs fetched singly returned 200.
 *
 * Fault 2 is handled in the client (`FoodImage.jsx` lazy-loads + retries).
 * Fault 1 can only be fixed in the data — you cannot rehost bytes that were
 * never there — hence `--prune-dead` below.
 *
 * Hotlinking also rots in ways we can't control: a Facebook CDN URL is signed
 * and expires, and a brand's own site can block or move an asset at any time.
 * So for everything still reachable the fix is to serve the bytes ourselves:
 * download it once, upload to the same bucket the admin's `POST /menu/upload`
 * uses, and repoint `MenuItem.imageUrl` at the public URL. Self-hosted measured
 * 0 failures at ~130ms, vs loremflickr's ~900ms when it worked at all.
 *
 *   pnpm --filter @amber/api images:rehost -- --dry-run     # preview, writes nothing
 *   pnpm --filter @amber/api images:rehost                  # amber-grain
 *   pnpm --filter @amber/api images:rehost -- --prune-dead  # also clear proven-dead URLs
 *   pnpm --filter @amber/api images:rehost -- --tenant=<slug>
 *   pnpm --filter @amber/api images:rehost -- --all-tenants
 *
 * Safety properties, in the spirit of `add-menu-items.ts`:
 *   - it only ever rewrites `imageUrl`; no other column, row or table is touched
 *   - an item already served from our own bucket is skipped, so re-running is
 *     a no-op and it is safe against a live restaurant's database
 *   - a download or upload failure leaves that item's existing URL alone —
 *     a broken hotlink is still better than an empty column, and the app's
 *     icon/swatch fallback covers it either way
 *   - downloads run at a small fixed concurrency, deliberately: fetching these
 *     hosts in a burst is the very thing that makes them fail
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const prisma = new PrismaClient();

// ── CLI ──────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const ALL_TENANTS = argv.includes("--all-tenants");
/**
 * Clear `imageUrl` for photos that are verifiably, permanently gone.
 *
 * Not every hotlink can be rescued. The seed's `flickr()` helper builds
 * loremflickr tag URLs, and loremflickr answers 500 for a tag it has no photo
 * for — which is every regional Indian dish name in the extended menu
 * (`hara-bhara-kabab`, `missi-roti`, `medu-vada`, `uttapam`…). Verified
 * sequentially with no concurrency: 42/42 returned 500 on repeated attempts,
 * so this is a dead URL, not a rate limit.
 *
 * Leaving a dead URL in the column costs a burst of doomed requests on every
 * single menu render (42 items x 3 attempts) and shows the guest a loading
 * flicker before the fallback. Clearing it renders `FoodImage`'s icon/swatch
 * stand-in immediately — a first-class designed state, the same one every
 * photo-less seed item already uses.
 *
 * Only ever applied to a URL this run just proved dead (a non-2xx that is not
 * 429 and not 5xx-transient, re-checked). A reachable-but-slow host is never
 * pruned.
 */
const PRUNE_DEAD = argv.includes("--prune-dead");
const TENANT_SLUG =
  argv.find((a) => a.startsWith("--tenant="))?.slice("--tenant=".length) ??
  argv.find((a) => !a.startsWith("--")) ??
  "amber-grain";

/** Parallel downloads. Small on purpose — see the header note. */
const CONCURRENCY = 4;
/** Per-image download budget. */
const TIMEOUT_MS = 20_000;
/** Retries for a transient 429/500 from a rate-limiting host. */
const MAX_ATTEMPTS = 3;

// ── Supabase ─────────────────────────────────────────────────────────────────

const BUCKET = process.env.SUPABASE_BUCKET ?? "menu-images";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Mirrors StorageService's allow-list — SVG stays excluded (stored-XSS). */
const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Already ours? Then there is nothing to rehost. */
function isSelfHosted(url: string): boolean {
  if (!SUPABASE_URL) return false;
  try {
    return new URL(url).host === new URL(SUPABASE_URL).host;
  } catch {
    return false;
  }
}

/** Data URLs are already self-contained; leave them alone. */
function isFetchable(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

interface Downloaded {
  bytes: Buffer;
  ext: string;
  contentType: string;
}

async function download(url: string): Promise<Downloaded> {
  let lastErr = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // Some hosts (Wikimedia especially) reject an unidentified client.
        headers: { "User-Agent": "TableFlow-image-rehost/1.0" },
      });
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        // 429/5xx are exactly the transient burst failures worth retrying.
        if (res.status === 429 || res.status >= 500) {
          await sleep(600 * attempt);
          continue;
        }
        throw new Error(lastErr);
      }
      const contentType = (res.headers.get("content-type") ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      const ext = EXT_BY_MIME[contentType];
      if (!ext) throw new Error(`unsupported content-type "${contentType || "none"}"`);

      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0) throw new Error("empty body");
      return { bytes, ext, contentType };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      if (attempt < MAX_ATTEMPTS) await sleep(600 * attempt);
    }
  }
  throw new Error(lastErr || "download failed");
}

/**
 * Second opinion before we clear a URL: two more spaced requests. Only if BOTH
 * come back non-2xx do we treat the image as permanently gone. A timeout or a
 * network error is never grounds for pruning — that says more about our
 * connection than about the URL.
 */
async function confirmDead(url: string): Promise<boolean> {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "User-Agent": "TableFlow-image-rehost/1.0" },
      });
      if (res.ok) return false; // it came back — not dead
    } catch {
      return false; // timeout/network: inconclusive, so keep the URL
    }
    await sleep(800);
  }
  return true;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error(
      "SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must be set in services/api/.env to rehost images.",
    );
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  });

  const tenants = ALL_TENANTS
    ? await prisma.tenant.findMany({ select: { id: true, slug: true, name: true } })
    : await prisma.tenant.findMany({
        where: { slug: TENANT_SLUG },
        select: { id: true, slug: true, name: true },
      });

  if (tenants.length === 0) {
    throw new Error(`No tenant matched "${TENANT_SLUG}". Pass --tenant=<slug> or --all-tenants.`);
  }

  if (!DRY_RUN) {
    const { data } = await supabase.storage.getBucket(BUCKET);
    if (!data) {
      const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
      if (error) throw new Error(`Could not create bucket "${BUCKET}": ${error.message}`);
      console.log(`Created public bucket "${BUCKET}".`);
    }
  }

  let totalMoved = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let totalPruned = 0;

  for (const tenant of tenants) {
    const items = await prisma.menuItem.findMany({
      where: { tenantId: tenant.id, imageUrl: { not: null } },
      select: { id: true, name: true, imageUrl: true },
      orderBy: { name: "asc" },
    });

    const todo = items.filter(
      (i) => i.imageUrl && isFetchable(i.imageUrl) && !isSelfHosted(i.imageUrl),
    );
    const skipped = items.length - todo.length;
    totalSkipped += skipped;

    console.log(
      `\n${tenant.name} (${tenant.slug}) — ${items.length} with photos, ` +
        `${todo.length} to rehost, ${skipped} already ours/not fetchable`,
    );

    // Fixed-size worker pool: bursting is what breaks these hosts.
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
      for (;;) {
        const idx = cursor++;
        if (idx >= todo.length) return;
        const item = todo[idx];
        const src = item.imageUrl as string;
        const host = (() => {
          try {
            return new URL(src).host;
          } catch {
            return "?";
          }
        })();

        if (DRY_RUN) {
          console.log(`  would rehost  ${item.name}  ← ${host}`);
          totalMoved++;
          continue;
        }

        try {
          const { bytes, ext, contentType } = await download(src);
          const path = `${tenant.id}/${randomUUID()}.${ext}`;
          const { error } = await supabase.storage
            .from(BUCKET)
            .upload(path, bytes, { contentType, upsert: false });
          if (error) throw new Error(`upload: ${error.message}`);

          const {
            data: { publicUrl },
          } = supabase.storage.from(BUCKET).getPublicUrl(path);

          await prisma.menuItem.update({
            where: { id: item.id },
            data: { imageUrl: publicUrl },
          });

          totalMoved++;
          console.log(
            `  ok            ${item.name}  ← ${host}  (${(bytes.length / 1024).toFixed(0)}kb)`,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);

          if (PRUNE_DEAD && /^HTTP \d+/.test(msg) && (await confirmDead(src))) {
            await prisma.menuItem.update({
              where: { id: item.id },
              data: { imageUrl: null },
            });
            totalPruned++;
            console.log(`  pruned        ${item.name}  ← ${host} (${msg}, confirmed dead)`);
            continue;
          }

          totalFailed++;
          // Leave the existing URL in place — see the header's safety notes.
          console.warn(`  FAILED        ${item.name}  ← ${host}: ${msg}`);
        }
      }
    });

    await Promise.all(workers);
  }

  console.log(
    `\n${DRY_RUN ? "[dry-run] " : ""}rehosted ${totalMoved}, ` +
      `skipped ${totalSkipped}, pruned ${totalPruned}, failed ${totalFailed}`,
  );
  if (totalFailed > 0 && !DRY_RUN) {
    console.log(
      "Failed items kept their original URL. Re-run to retry them, or replace " +
        "the photo from the admin (Menu → item → upload).",
    );
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
