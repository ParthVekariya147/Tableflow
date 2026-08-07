import { readFile, writeFile, mkdir } from "node:fs/promises";
import { hostname, platform } from "node:os";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  printJobSchema,
  type PrintJob,
  type RelayPrinter,
} from "@amber/domain";
import { executeJob } from "../executeJob.js";
import { listSystemPrinters } from "./listPrinters.js";

/**
 * Outbound relay client — the agent dials the API and stays connected.
 *
 * This is what makes printing work from a phone. The browser can't reach
 * `http://192.168.x.x` from an HTTPS page (mixed content, and iOS/PWAs have no
 * override), so instead of the browser reaching in, the agent reaches OUT and
 * the API pushes jobs down that pipe.
 *
 * Downstream is SSE consumed with native `fetch` streaming (no dependency, and
 * no reliance on Node's still-experimental global EventSource). Upstream is a
 * plain POST per job result. Reconnects forever with capped backoff, because a
 * till that silently stops printing after a router blip is worse than useless.
 */

const AGENT_ID_FILE = join(
  process.env.AGENT_STATE_DIR ?? ".agent",
  "agent-id",
);
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/** No frame at all for this long means the connection is dead (the API pings
 *  every 25s), so drop it and redial rather than waiting on a half-open TCP. */
const STALE_AFTER_MS = 70_000;

export interface RelayConfig {
  apiUrl: string;
  tenantSlug: string;
  agentSecret: string;
  agentName?: string;
  version: string;
}

/** Stable across restarts so a reconnect isn't mistaken for a second till. */
async function resolveAgentId(): Promise<string> {
  try {
    const existing = (await readFile(AGENT_ID_FILE, "utf8")).trim();
    if (existing) return existing;
  } catch {
    /* first run */
  }
  const minted = randomUUID();
  try {
    await mkdir(dirname(AGENT_ID_FILE), { recursive: true });
    await writeFile(AGENT_ID_FILE, minted, "utf8");
  } catch {
    // Read-only deployment: the id just won't persist across restarts.
  }
  return minted;
}

export class RelayClient {
  private stopped = false;
  private attempt = 0;
  private agentId?: string;

  constructor(private readonly config: RelayConfig) {}

  async start(): Promise<void> {
    this.agentId = await resolveAgentId();
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
  }

  private log(message: string): void {
    console.log(`[relay] ${message}`);
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.connectOnce();
        // A clean end still means the stream closed — reconnect promptly.
        this.attempt = 0;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // 401 is a configuration problem, not a blip: back off hard and say so
        // rather than hammering the API with a bad key.
        this.log(`disconnected: ${message}`);
      }
      if (this.stopped) return;
      const wait = Math.min(
        RECONNECT_MAX_MS,
        RECONNECT_MIN_MS * 2 ** Math.min(this.attempt, 5),
      );
      this.attempt += 1;
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  private async registration(): Promise<string> {
    const printers: RelayPrinter[] = await listSystemPrinters();
    return JSON.stringify({
      agentId: this.agentId,
      agentName: this.config.agentName ?? hostname(),
      version: this.config.version,
      platform: platform(),
      printers,
    });
  }

  private async connectOnce(): Promise<void> {
    const url = `${this.config.apiUrl.replace(/\/+$/, "")}/print/agent/stream`;
    const controller = new AbortController();
    const res = await fetch(url, {
      headers: {
        Accept: "text/event-stream",
        "X-Tenant-Slug": this.config.tenantSlug,
        "X-Agent-Secret": this.config.agentSecret,
        "X-Agent-Registration": await this.registration(),
      },
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`relay refused the connection (${res.status}) ${detail}`);
    }
    this.log(`connected to ${url} as ${this.config.tenantSlug}`);
    this.attempt = 0;

    // Watchdog: the API pings every 25s, so silence means a half-open socket.
    let lastFrame = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastFrame > STALE_AFTER_MS) controller.abort();
    }, 10_000);
    watchdog.unref?.();

    try {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        lastFrame = Date.now();
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line; each `data:` line carries
        // one JSON payload (Nest serializes MessageEvent.data that way).
        let split: number;
        while ((split = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          this.handleFrame(frame);
        }
      }
    } finally {
      clearInterval(watchdog);
    }
  }

  private handleFrame(frame: string): void {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    const event = parsed as { type?: string; job?: unknown };
    if (event.type === "ready") {
      this.log("registered with the relay");
      return;
    }
    if (event.type !== "job") return;

    const job = printJobSchema.safeParse(event.job);
    if (!job.success) {
      this.log("ignored a malformed job");
      return;
    }
    // Fire and forget: a slow printer must not block the stream reader, or a
    // second job queued behind it would stall the whole till.
    void this.runJob(job.data);
  }

  private async runJob(job: PrintJob): Promise<void> {
    this.log(`job ${job.jobId} (${job.kind})`);
    let result;
    try {
      result = await executeJob(job);
    } catch (err) {
      result = {
        jobId: job.jobId,
        ok: false,
        reason: "printer" as const,
        error: err instanceof Error ? err.message : "Print failed",
      };
    }
    try {
      await fetch(
        `${this.config.apiUrl.replace(/\/+$/, "")}/print/agent/result`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Tenant-Slug": this.config.tenantSlug,
            "X-Agent-Secret": this.config.agentSecret,
          },
          body: JSON.stringify(result),
        },
      );
    } catch (err) {
      // The submitter will time out and report it; nothing else to do.
      this.log(
        `couldn't report job ${job.jobId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
