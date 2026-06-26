import type { z } from "zod";

/** Thrown for any non-2xx response. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientConfig {
  /** Base URL of services/api, e.g. "https://api.example.com". */
  baseUrl: string;
  /**
   * Active tenant slug. Sent as the X-Tenant-Slug header so the API can scope
   * every query. Super-admin calls may omit this.
   */
  tenantSlug?: string;
  /**
   * Dynamic alternative to `tenantSlug`, read at call time. Lets a long-lived
   * client follow the *logged-in* tenant (e.g. the admin panel reads the chosen
   * tenant from storage after an email-first login) without being recreated.
   * Used only when a static `tenantSlug` isn't set.
   */
  getTenantSlug?: () => string | null | undefined;
  /** Returns a bearer token for authenticated (admin) calls, if any. */
  getToken?: () => string | null | undefined;
  /**
   * Returns this guest device's opaque id, sent as `X-Device-Id`. It binds a
   * dine-in session to the device that opened it (the server stores it on the
   * Order and enforces ownership on writes/resume). Omitted by staff.
   */
  getDeviceId?: () => string | null | undefined;
  /** Injectable fetch (defaults to global fetch); handy for tests/SSR. */
  fetch?: typeof fetch;
  /**
   * Per-request timeout in ms. A hung request (e.g. the API blocked on a slow/
   * unreachable DB) would otherwise never settle, leaving callers stuck on a
   * loading state forever. On timeout the request aborts and rejects with an
   * `ApiError(0, …)`. Defaults to 15s; multipart uploads get at least 60s.
   */
  timeoutMs?: number;
}

export interface RequestOptions<S extends z.ZodTypeAny> {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** JSON-serialized, unless it's a FormData (sent as multipart). */
  body?: unknown;
  /** Zod schema used to validate + type the response body. */
  schema: S;
  /** Override the configured tenant for this call. */
  tenantSlug?: string;
}

/**
 * Internal request helper. Every resource method goes through here so headers,
 * tenant scoping, error handling, and response validation are centralized.
 *
 * Generic over the schema (not its type) so the return is the schema's *output*
 * type — fields with .default() are guaranteed present, matching domain types.
 */
export async function request<S extends z.ZodTypeAny>(
  config: ApiClientConfig,
  path: string,
  opts: RequestOptions<S>,
): Promise<z.output<S>> {
  const doFetch = config.fetch ?? globalThis.fetch;
  const headers: Record<string, string> = { Accept: "application/json" };

  const tenant =
    opts.tenantSlug ?? config.tenantSlug ?? config.getTenantSlug?.();
  if (tenant) headers["X-Tenant-Slug"] = tenant;

  const token = config.getToken?.();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const deviceId = config.getDeviceId?.();
  if (deviceId) headers["X-Device-Id"] = deviceId;

  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    // Let fetch set multipart/form-data + boundary itself.
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  // Abort a request that hangs too long (slow/unreachable DB) so callers fail
  // fast with an error instead of spinning on a loading state indefinitely.
  const isUpload = opts.body instanceof FormData;
  const timeoutMs = isUpload
    ? Math.max(config.timeoutMs ?? 15_000, 60_000)
    : config.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await doFetch(`${config.baseUrl}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body,
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new ApiError(0, `Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  const json = text ? safeParse(text) : undefined;

  if (!res.ok) {
    const message =
      (json && typeof json === "object" && "message" in json
        ? String((json as { message: unknown }).message)
        : res.statusText) || `Request failed (${res.status})`;
    throw new ApiError(res.status, message, json);
  }

  return opts.schema.parse(json);
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
