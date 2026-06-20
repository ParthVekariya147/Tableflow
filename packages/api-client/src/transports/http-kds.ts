/**
 * HTTP/SSE KDS transport — the "now" implementation.
 *
 * Server→client realtime is Server-Sent Events (EventSource); client→server is
 * plain JSON POST. Both are cross-origin (CORS), so the customer (:5173) and the
 * KDS (:5174) can sync through a tiny relay on a third port with no shared
 * origin. It is dependency-free on the server side (Node `node:http`).
 *
 * To move to the real backend later, keep this transport and point `baseUrl` at
 * the NestJS service, or write a sibling transport that satisfies KdsTransport.
 */
import {
  applyKdsEvent,
  type KdsEvent,
  type KdsStage,
  type KdsTicket,
  type KdsTransport,
  type PublishRoundInput,
} from "../kds.js";

export interface HttpKdsTransportConfig {
  /** Base URL of the KDS relay, e.g. "http://localhost:4001". */
  baseUrl: string;
  /** Injectable fetch (defaults to global fetch); handy for tests. */
  fetch?: typeof fetch;
}

export function createHttpKdsTransport(
  config: HttpKdsTransportConfig,
): KdsTransport {
  const base = config.baseUrl.replace(/\/$/, "");
  const doFetch = config.fetch ?? globalThis.fetch;
  const handlers = new Set<(e: KdsEvent) => void>();
  let source: EventSource | null = null;

  function openStream() {
    if (source) return;
    source = new EventSource(`${base}/kds/stream`);
    source.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as KdsEvent;
        handlers.forEach((h) => h(event));
      } catch {
        /* ignore malformed frames */
      }
    };
    // EventSource auto-reconnects on error; nothing to do here.
  }

  async function postJson(path: string, body: unknown): Promise<Response> {
    const res = await doFetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`KDS ${path} failed (${res.status})`);
    return res;
  }

  return {
    async list() {
      const res = await doFetch(`${base}/kds/tickets`);
      if (!res.ok) throw new Error(`KDS list failed (${res.status})`);
      return (await res.json()) as KdsTicket[];
    },
    subscribe(handler) {
      handlers.add(handler);
      openStream();
      return () => {
        handlers.delete(handler);
        if (handlers.size === 0 && source) {
          source.close();
          source = null;
        }
      };
    },
    async publishRound(input: PublishRoundInput) {
      const res = await postJson("/kds/rounds", input);
      return (await res.json()) as KdsTicket;
    },
    async setStage(ticketId: string, stage: KdsStage) {
      await postJson("/kds/stage", { ticketId, stage });
    },
    close() {
      source?.close();
      source = null;
      handlers.clear();
    },
  };
}

// Re-exported for consumers that want the reducer alongside the transport.
export { applyKdsEvent };
