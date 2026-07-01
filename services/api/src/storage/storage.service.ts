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
}
