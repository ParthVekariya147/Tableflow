/**
 * Fill in photos for menu items that have none, from Wikimedia — then serve
 * them from OUR bucket, never hotlinked.
 *
 * Companion to `rehost-images.ts`. That script rescues existing hotlinks and
 * prunes dead ones; this one sources a photo where there is no usable URL at
 * all (after the prune, 43 of Amber & Grain's 75 items were icon stand-ins).
 *
 * How a dish is resolved, in order:
 *   1. an explicit entry in OVERRIDES (below) — for names Wikipedia does not
 *      title the way a menu does ("Pani Puri (6 pcs)" → "Panipuri")
 *   2. the cleaned item name as an article title
 *   3. Wikipedia's search API, taking the best-matching article
 * Then the article's lead image is pulled at ~900px (`pageimages`), downloaded,
 * uploaded to Supabase Storage, and written to `MenuItem.imageUrl`.
 *
 *   pnpm --filter @amber/api images:fill -- --dry-run    # preview, writes nothing
 *   pnpm --filter @amber/api images:fill                 # amber-grain
 *   pnpm --filter @amber/api images:fill -- --tenant=<slug>
 *
 * ⚠️ LICENSING — READ BEFORE USING THIS ON A REAL RESTAURANT'S MENU.
 * Wikimedia photos are freely licensed but most are CC BY-SA, which requires
 * **crediting the photographer** wherever the image is shown. That is fine for
 * a demo/seed dataset; for a live menu that paying guests see, either comply
 * with the attribution or replace these with the restaurant's own photography
 * (admin → Menu → item → upload). This script therefore records the license and
 * author of every image it uses in `prisma/image-attribution.json` so the
 * obligation is at least documented rather than invisible.
 *
 * Safety: only ever sets `imageUrl` on items where it is currently NULL. It
 * never overwrites an existing photo, so it cannot clobber a real upload, and
 * re-running only picks up whatever is still missing.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const prisma = new PrismaClient();

// ── CLI ──────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const ALL_TENANTS = argv.includes("--all-tenants");
const TENANT_SLUG =
  argv.find((a) => a.startsWith("--tenant="))?.slice("--tenant=".length) ??
  argv.find((a) => !a.startsWith("--")) ??
  "amber-grain";

/**
 * Wikimedia asks anonymous clients to make API requests **serially**, and it
 * enforces it: a first pass at concurrency 3 tripped the limiter within
 * seconds, after which every lookup came back as the plain-text "You are
 * making too many requests" body. That is not JSON, so it silently surfaced as
 * "no match" for 29 of 43 dishes — a rate limit wearing the disguise of
 * missing data. Hence: one request at a time, spaced, with explicit 429
 * handling that says *rate limited* rather than *not found*.
 */
const CONCURRENCY = 1;
/** Minimum gap between Wikimedia API calls. */
const API_INTERVAL_MS = 1_200;
const TIMEOUT_MS = 25_000;
const THUMB_WIDTH = 900;
const UA = "TableFlow-image-fill/1.0 (restaurant menu seed data)";

/** Thrown when Wikimedia limits us, so it is never mistaken for "no photo". */
class RateLimited extends Error {
  constructor() {
    super("Wikimedia rate limit");
  }
}

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

/**
 * Menu names Wikipedia doesn't title the same way. Left side is matched
 * case-insensitively against the item name; right side is the article to use.
 * A combo or a portion-size suffix resolves to its headline dish.
 */
const OVERRIDES: Record<string, string> = {
  "pani puri (6 pcs)": "Panipuri",
  "dahi puri": "Dahi puri",
  "idli sambar (3 pcs)": "Idli",
  "medu vada (2 pcs)": "Medu vada",
  "spring rolls (4 pcs)": "Spring roll",
  "veg thali": "Thali",
  "deluxe veg thali": "Thali",
  "non-veg thali": "Thali",
  "dosa & filter coffee combo": "Masala dosa",
  "pav bhaji & lassi combo": "Pav bhaji",
  "cheese grilled sandwich": "Cheese sandwich",
  "chilli cheese toast": "Cheese on toast",
  "masala fries": "French fries",
  "boondi raita": "Raita",
  "mango lassi": "Lassi",
  "filter coffee": "Indian filter coffee",
  "fresh lime soda": "Lemonade",
  "cold coffee": "Iced coffee",
  "kulfi falooda": "Falooda",
  "masala papad": "Papadum",
  "samosa chaat": "Chaat",
  "cheese naan": "Naan",
  "veg hakka noodles": "Chow mein",
  "jeera rice": "Cumin",
  "curd rice": "Curd rice",
  "missi roti": "Missi roti",
  "hara bhara kabab": "Kebab",
  "kadai chicken": "Karahi",
  "paneer butter masala": "Shahi paneer",
  "veg biryani": "Biryani",
  "mutton biryani": "Biryani",
  "chicken biryani": "Biryani",
  "chicken tikka": "Chicken tikka",
  "rava dosa": "Dosa (food)",
  "masala dosa": "Masala dosa",
  "chilli paneer": "Paneer",
  "veg pulao": "Pilaf",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Serial, paced, backing-off Wikimedia API call returning parsed JSON.
 *
 * Every API request in this script goes through here — the pacing is only
 * meaningful if nothing bypasses it. A limited response is detected two ways:
 * HTTP 429, and a 200 whose body is the plain-text limit notice instead of
 * JSON (the API does both).
 */
let apiChain: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

function wikiApi<T>(url: string): Promise<T> {
  const run = async (): Promise<T> => {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const wait = API_INTERVAL_MS - (Date.now() - lastCallAt);
      if (wait > 0) await sleep(wait);
      lastCallAt = Date.now();

      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = await res.text();

      if (res.status === 429 || /too many requests/i.test(body.slice(0, 200))) {
        if (attempt === 4) throw new RateLimited();
        await sleep(2_000 * attempt * attempt); // 2s, 8s, 18s
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      try {
        return JSON.parse(body) as T;
      } catch {
        throw new Error("non-JSON response");
      }
    }
    throw new RateLimited();
  };

  // Chain so calls never overlap, even across the worker pool.
  const next = apiChain.then(run, run);
  apiChain = next.catch(() => undefined);
  return next as Promise<T>;
}

/** Strip portion counts and combo suffixes: "Idli Sambar (3 pcs)" → "Idli Sambar". */
function cleanName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s*&\s*.*combo\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface Found {
  imageUrl: string;
  article: string;
  fileTitle: string;
}

/** Lead image for an exact article title, at THUMB_WIDTH. */
async function leadImage(title: string): Promise<Found | null> {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
    `&prop=pageimages&piprop=thumbnail|name&pithumbsize=${THUMB_WIDTH}` +
    `&redirects=1&titles=${encodeURIComponent(title)}`;
  const json = await wikiApi<{
    query?: {
      pages?: Record<
        string,
        { title?: string; thumbnail?: { source?: string }; pageimage?: string }
      >;
    };
  }>(url);
  const pages = Object.values(json.query?.pages ?? {});
  for (const p of pages) {
    if (p.thumbnail?.source) {
      return {
        imageUrl: p.thumbnail.source,
        article: p.title ?? title,
        fileTitle: p.pageimage ?? "",
      };
    }
  }
  return null;
}

/** Fall back to search when the title guess misses. */
async function searchImage(term: string): Promise<Found | null> {
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*` +
    `&list=search&srlimit=3&srsearch=${encodeURIComponent(term)}`;
  const json = await wikiApi<{ query?: { search?: { title: string }[] } }>(url);
  for (const hit of json.query?.search ?? []) {
    const found = await leadImage(hit.title);
    if (found) return found;
  }
  return null;
}

async function resolvePhoto(itemName: string): Promise<Found | null> {
  const override = OVERRIDES[itemName.toLowerCase()];
  if (override) {
    const byOverride = await leadImage(override);
    if (byOverride) return byOverride;
  }
  const cleaned = cleanName(itemName);
  const direct = await leadImage(cleaned);
  if (direct) return direct;
  return searchImage(`${cleaned} dish food`);
}

/** License + author for the Commons file, so the obligation is on record. */
async function attribution(
  fileTitle: string,
): Promise<{ license: string; author: string } | null> {
  if (!fileTitle) return null;
  try {
    const url =
      `https://commons.wikimedia.org/w/api.php?action=query&format=json` +
      `&prop=imageinfo&iiprop=extmetadata&titles=${encodeURIComponent(`File:${fileTitle}`)}`;
    const json = await wikiApi<{
      query?: {
        pages?: Record<
          string,
          { imageinfo?: { extmetadata?: Record<string, { value?: string }> }[] }
        >;
      };
    }>(url);
    const meta = Object.values(json.query?.pages ?? {})[0]?.imageinfo?.[0]?.extmetadata;
    const strip = (s?: string) =>
      (s ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    return {
      license: strip(meta?.LicenseShortName?.value) || "unknown",
      author: strip(meta?.Artist?.value) || "unknown",
    };
  } catch {
    return null;
  }
}

/**
 * upload.wikimedia.org rate-limits independently of the API, so a 429 here is
 * transient and must back off rather than lose the dish (it cost one item on
 * the first run).
 */
async function download(url: string): Promise<{ bytes: Buffer; ext: string; contentType: string }> {
  let lastErr = "";
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429 || res.status >= 500) {
      lastErr = `HTTP ${res.status}`;
      await sleep(3_000 * attempt * attempt); // 3s, 12s, 27s
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const ext = EXT_BY_MIME[contentType];
    if (!ext) throw new Error(`unsupported content-type "${contentType || "none"}"`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) throw new Error("empty body");
    return { bytes, ext, contentType };
  }
  throw new Error(lastErr || "download failed");
}

// ── Main ─────────────────────────────────────────────────────────────────────

interface AttributionRow {
  tenant: string;
  item: string;
  article: string;
  sourceFile: string;
  license: string;
  author: string;
}

async function main(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must be set in services/api/.env.");
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

  const tenants = ALL_TENANTS
    ? await prisma.tenant.findMany({ select: { id: true, slug: true, name: true } })
    : await prisma.tenant.findMany({
        where: { slug: TENANT_SLUG },
        select: { id: true, slug: true, name: true },
      });
  if (tenants.length === 0) throw new Error(`No tenant matched "${TENANT_SLUG}".`);

  const credits: AttributionRow[] = [];
  let filled = 0;
  let missed = 0;
  let rateLimited = 0;

  for (const tenant of tenants) {
    // Only NULL imageUrl — never overwrite a real photo.
    const items = await prisma.menuItem.findMany({
      where: { tenantId: tenant.id, imageUrl: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    console.log(`\n${tenant.name} (${tenant.slug}) — ${items.length} items without a photo`);

    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      for (;;) {
        const idx = cursor++;
        if (idx >= items.length) return;
        const item = items[idx];

        try {
          const found = await resolvePhoto(item.name);
          if (!found) {
            missed++;
            console.warn(`  no match      ${item.name}`);
            continue;
          }

          if (DRY_RUN) {
            filled++;
            console.log(`  would fill    ${item.name}  ← "${found.article}"`);
            continue;
          }

          const { bytes, ext, contentType } = await download(found.imageUrl);
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

          const credit = await attribution(found.fileTitle);
          credits.push({
            tenant: tenant.slug,
            item: item.name,
            article: found.article,
            sourceFile: found.fileTitle,
            license: credit?.license ?? "unknown",
            author: credit?.author ?? "unknown",
          });

          filled++;
          console.log(
            `  ok            ${item.name}  ← "${found.article}" (${(bytes.length / 1024).toFixed(0)}kb, ${credit?.license ?? "?"})`,
          );
        } catch (e) {
          if (e instanceof RateLimited) {
            rateLimited++;
            console.warn(`  RATE-LIMITED  ${item.name} — re-run to pick it up`);
            await sleep(5_000);
            continue;
          }
          missed++;
          console.warn(
            `  FAILED        ${item.name}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    });

    await Promise.all(workers);
  }

  if (!DRY_RUN && credits.length > 0) {
    const out = join(__dirname, "image-attribution.json");
    // MERGE, don't overwrite. This file accumulates across runs, and each run
    // only handles the items still missing a photo — a plain write silently
    // discarded every credit recorded by the previous pass.
    let existing: AttributionRow[] = [];
    try {
      existing = JSON.parse(readFileSync(out, "utf8")) as AttributionRow[];
    } catch {
      existing = [];
    }
    const byKey = new Map(existing.map((r) => [`${r.tenant}::${r.item}`, r]));
    for (const row of credits) byKey.set(`${row.tenant}::${row.item}`, row);
    const merged = [...byKey.values()].sort(
      (a, b) => a.tenant.localeCompare(b.tenant) || a.item.localeCompare(b.item),
    );
    writeFileSync(out, JSON.stringify(merged, null, 2));
    console.log(
      `\nAttribution: +${credits.length} this run, ${merged.length} total, written to ${out}`,
    );
    console.log(
      "⚠️  Most Wikimedia photos are CC BY-SA — crediting the author is a license\n" +
        "    condition wherever the image is shown. Fine for demo data; for a live\n" +
        "    menu, comply or replace these with the restaurant's own photography.",
    );
  }

  console.log(`\n${DRY_RUN ? "[dry-run] " : ""}filled ${filled}, unmatched ${missed}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
