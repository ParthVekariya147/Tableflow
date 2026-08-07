import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnModuleInit,
} from "@nestjs/common";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Allow-listed raster image mime types → stored file extension. `image/svg+xml`
 * is deliberately EXCLUDED: an SVG can carry `<script>`/event-handler payloads
 * and would be served back from the public bucket with the client-supplied
 * content-type, i.e. a stored-XSS vector. This map is also the exact allow-list
 * (see `isAllowedImageMime`) — there is no fallback to a client-supplied
 * filename extension for anything outside it.
 */
const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

/** Exact allow-list check — NOT `mimetype.startsWith("image/")`, which would
 *  also admit `image/svg+xml` and anything else with that prefix. */
export function isAllowedImageMime(mimetype: string): boolean {
  return mimetype in EXT_BY_MIME;
}

/**
 * Wraps Supabase Storage. Item photos are uploaded here (service-role key, so
 * the secret never leaves the server) and only the resulting public URL is
 * stored on `MenuItem.imageUrl`. Disabled gracefully if env vars are unset.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket = process.env.SUPABASE_BUCKET ?? "menu-images";
  private readonly client: SupabaseClient | null;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    this.client =
      url && key
        ? createClient(url, key, { auth: { persistSession: false } })
        : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /** Ensure the public bucket exists on boot (best-effort). */
  async onModuleInit(): Promise<void> {
    if (!this.client) {
      this.logger.warn(
        "Supabase Storage disabled (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to enable image uploads).",
      );
      return;
    }
    try {
      const { data } = await this.client.storage.getBucket(this.bucket);
      if (!data) {
        const { error } = await this.client.storage.createBucket(this.bucket, {
          public: true,
        });
        if (error) throw error;
        this.logger.log(`Created public storage bucket "${this.bucket}".`);
      }
    } catch (e) {
      this.logger.warn(
        `Could not verify/create bucket "${this.bucket}": ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  /**
   * Upload an image and return its public URL. Objects are namespaced per
   * tenant: `<tenantId>/<uuid>.<ext>`.
   */
  async uploadImage(
    tenantId: string,
    file: Express.Multer.File,
  ): Promise<string> {
    if (!this.client)
      throw new ServiceUnavailableException("Image storage is not configured.");

    // Defense in depth: the controller already checks this, but the extension
    // used in the storage KEY must never come from client-controlled input
    // (originalname) — only ever from this fixed, server-side map.
    const ext = EXT_BY_MIME[file.mimetype];
    if (!ext) {
      throw new BadRequestException(`Unsupported image type: ${file.mimetype}`);
    }
    const path = `${tenantId}/${randomUUID()}.${ext}`;

    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });
    if (error)
      throw new ServiceUnavailableException(`Upload failed: ${error.message}`);

    const { data } = this.client.storage.from(this.bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  /**
   * Fetch an image from a URL and store it as our own, returning the public URL.
   *
   * Staff paste photo links from wherever they found the dish, and a hotlink is
   * not a photo — it is a dependency on someone else's server. They expire
   * (a Facebook CDN link is signed), get hotlink-blocked, rate-limit under the
   * burst of a full menu render, or simply 404 later. Importing on paste means
   * "use link" and "upload file" end in the same place: bytes in our bucket.
   *
   * SSRF guard: this fetches a URL supplied by an authenticated staff user, so
   * it is restricted to http(s) and to hosts that do not resolve into private
   * network space — otherwise it would be a probe into the API's own network.
   */
  async importImageFromUrl(tenantId: string, rawUrl: string): Promise<string> {
    if (!this.client)
      throw new ServiceUnavailableException("Image storage is not configured.");

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new BadRequestException("Enter a full image link starting with http:// or https://");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      throw new BadRequestException("Only http:// and https:// links are supported.");
    if (isPrivateHost(parsed.hostname))
      throw new BadRequestException("That link points to a private network address.");

    let res: Response;
    try {
      res = await fetch(parsed.toString(), {
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
        headers: { "User-Agent": "TableFlow/1.0 (menu image import)" },
      });
    } catch {
      throw new BadRequestException("Could not reach that link. Check it opens in a browser.");
    }
    if (!res.ok)
      throw new BadRequestException(`That link returned HTTP ${res.status}.`);

    const contentType = ((res.headers.get("content-type") ?? "").split(";")[0] ?? "")
      .trim()
      .toLowerCase();
    if (!isAllowedImageMime(contentType))
      throw new BadRequestException(
        "That link is not a PNG, JPEG, WEBP, GIF or AVIF image. Use a direct image link.",
      );

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) throw new BadRequestException("That link returned an empty image.");
    if (buffer.length > MAX_IMPORT_BYTES)
      throw new BadRequestException("That image is larger than 5 MB.");

    const ext = EXT_BY_MIME[contentType];
    const path = `${tenantId}/${randomUUID()}.${ext}`;
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(path, buffer, { contentType, upsert: false });
    if (error)
      throw new ServiceUnavailableException(`Upload failed: ${error.message}`);

    const { data } = this.client.storage.from(this.bucket).getPublicUrl(path);
    this.logger.log(`Imported ${parsed.hostname} → ${path}`);
    return data.publicUrl;
  }
}

/** Same 5 MB ceiling the multipart upload endpoint enforces. */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * Block obvious SSRF targets: loopback, link-local, and RFC1918 ranges, plus
 * bare hostnames with no dot (which resolve to internal services in most
 * container networks). Not a complete defence against DNS rebinding, but it
 * stops the straightforward "paste http://169.254.169.254/…" probe.
 */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal")) return true;
  if (!h.includes(".")) return true; // bare container/service names
  if (h === "[::1]" || h === "::1") return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) || // link-local incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
