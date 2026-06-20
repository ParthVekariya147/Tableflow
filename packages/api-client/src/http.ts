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
  /** Returns a bearer token for authenticated (admin) calls, if any. */
  getToken?: () => string | null | undefined;
  /** Injectable fetch (defaults to global fetch); handy for tests/SSR. */
  fetch?: typeof fetch;
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

  const tenant = opts.tenantSlug ?? config.tenantSlug;
  if (tenant) headers["X-Tenant-Slug"] = tenant;

  const token = config.getToken?.();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    // Let fetch set multipart/form-data + boundary itself.
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  const res = await doFetch(`${config.baseUrl}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body,
  });

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
