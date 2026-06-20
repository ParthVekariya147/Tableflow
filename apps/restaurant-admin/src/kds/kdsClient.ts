import { createHttpKdsTransport, type KdsTransport } from "@amber/api-client";

/**
 * The KDS data source for this app. Today it's the local SSE relay; to move to
 * the real backend, change this one line (point baseUrl at @amber/api, or swap
 * in a different KdsTransport implementation). No board code changes.
 */
const baseUrl = import.meta.env.VITE_KDS_URL ?? "http://localhost:4001";

export const kdsClient: KdsTransport = createHttpKdsTransport({ baseUrl });
