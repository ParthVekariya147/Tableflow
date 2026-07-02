import type { PrinterSettings, Receipt } from "@amber/domain";

/**
 * Talks to the local print agent (services/print-agent) directly — deliberately
 * NOT through @amber/api-client, since the agent is a per-deployment host (often
 * a different device on the LAN, not the Amber API) with no tenant header, no
 * auth token, and no domain-schema response validation against the Amber
 * contract. See PRINT_RECEIPT_PLAN.md §6.1.
 */

const AGENT_TIMEOUT_MS = 8000;

export type PrintResult =
  | { ok: true }
  | { ok: false; reason: "unreachable" | "unauthorized" | "config" | "printer"; message: string };

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

async function callAgent(
  settings: PrinterSettings,
  path: string,
  body: unknown,
): Promise<PrintResult> {
  const agentUrl = settings.agentUrl ?? "http://localhost:9200";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
  try {
    const res = await fetch(`${trimTrailingSlash(agentUrl)}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settings.agentSecret ? { "X-Agent-Secret": settings.agentSecret } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (res.status === 401) {
      return {
        ok: false,
        reason: "unauthorized",
        message: "Security key doesn't match — check Settings → Printer.",
      };
    }
    const data = (await res.json().catch(() => null)) as
      | { success?: boolean; error?: string }
      | null;
    if (res.ok && data?.success) return { ok: true };
    return {
      ok: false,
      reason: res.status === 400 ? "config" : "printer",
      message: data?.error ?? "Print failed.",
    };
  } catch {
    return {
      ok: false,
      reason: "unreachable",
      message: `Can't reach the print agent at ${agentUrl}. Is it running?`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Formats and prints a full receipt. */
export function printReceipt(settings: PrinterSettings, receipt: Receipt): Promise<PrintResult> {
  return callAgent(settings, "/print", { connection: settings, receipt });
}

/** Prints a short fixed test slip — used by Settings → Printer to verify wiring. */
export function printTestReceipt(settings: PrinterSettings): Promise<PrintResult> {
  return callAgent(settings, "/print/test", { connection: settings });
}

/** Basic reachability check for the agent itself (no secret required — /health is open). */
export async function checkAgentHealth(agentUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
  try {
    const res = await fetch(`${trimTrailingSlash(agentUrl)}/health`, {
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
