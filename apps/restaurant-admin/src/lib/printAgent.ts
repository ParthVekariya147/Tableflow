import type { Kot, PrinterSettings, Receipt } from "@amber/domain";
import { api } from "./api";

/**
 * Printing has TWO transports, and the right one depends on where the browser
 * can actually reach:
 *
 *  1. **Direct LAN** (original): the browser POSTs straight to the agent on
 *     `http://<host>:9200`. Fast, works offline from the internet, and is what
 *     a desktop till on the same machine has always used. Kept unchanged.
 *
 *  2. **Cloud relay** (new): the browser POSTs the job to the Amber API over
 *     ordinary same-origin HTTPS, and the API pushes it down the agent's own
 *     outbound connection. This is the ONLY transport that works from a phone,
 *     an installed PWA, or iOS Safari, because a browser refuses to let an
 *     https page call an http LAN address (mixed content — no override exists
 *     in installed PWAs or on iOS).
 *
 * Selection is automatic and, critically, *not* a fallback-after-failure: when
 * the page is https and the agent URL is plain http, the direct call is not
 * merely slow, it is **blocked before it leaves the browser**, and some engines
 * report that as an opaque network error only after a delay. So that
 * combination skips straight to the relay. Everything else tries direct first
 * (preserving today's desktop behaviour and its speed) and falls back to the
 * relay if the agent isn't reachable.
 */

const AGENT_TIMEOUT_MS = 8000;

export type PrintTransport = "direct" | "relay";

export type PrintResult =
  | { ok: true; transport: PrintTransport }
  | {
      ok: false;
      reason: "unreachable" | "unauthorized" | "config" | "printer" | "offline";
      message: string;
      transport?: PrintTransport;
    };

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * True when the browser will refuse the direct call outright. An https page may
 * only reach https (or localhost, which every engine treats as a secure
 * context). Anything else is blocked as mixed content.
 */
export function directWouldBeBlocked(agentUrl: string): boolean {
  if (typeof window === "undefined") return false;
  if (window.location.protocol !== "https:") return false;
  try {
    const target = new URL(agentUrl);
    if (target.protocol === "https:") return false;
    return !(
      target.hostname === "localhost" ||
      target.hostname === "127.0.0.1" ||
      target.hostname === "[::1]"
    );
  } catch {
    return true;
  }
}

async function callAgentDirect(
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
        transport: "direct",
        message: "Security key doesn't match — check Settings → Printer.",
      };
    }
    const data = (await res.json().catch(() => null)) as
      | { success?: boolean; error?: string }
      | null;
    if (res.ok && data?.success) return { ok: true, transport: "direct" };
    return {
      ok: false,
      reason: res.status === 400 ? "config" : "printer",
      transport: "direct",
      message: data?.error ?? "Print failed.",
    };
  } catch {
    return {
      ok: false,
      reason: "unreachable",
      transport: "direct",
      message: `Can't reach the print agent at ${agentUrl}. Is it running?`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callRelay(input: {
  kind: "receipt" | "kot" | "test";
  connection: PrinterSettings;
  receipt?: Receipt;
  kot?: Kot;
  printerId?: string;
}): Promise<PrintResult> {
  try {
    const result = await api.print.job(input);
    if (result.ok) return { ok: true, transport: "relay" };
    const reason =
      result.reason === "offline" || result.reason === "timeout"
        ? "offline"
        : result.reason === "config"
          ? "config"
          : "printer";
    return {
      ok: false,
      reason,
      transport: "relay",
      message:
        result.error ??
        (reason === "offline"
          ? "No print agent is connected for this restaurant."
          : "Print failed."),
    };
  } catch (e) {
    return {
      ok: false,
      reason: "unreachable",
      transport: "relay",
      message:
        e instanceof Error
          ? e.message
          : "Couldn't reach the server to send the print job.",
    };
  }
}

/**
 * Try direct first where it's viable, then the relay. A `config` failure is
 * NOT retried over the relay — bad settings will fail identically there, and
 * retrying only delays the real error reaching staff.
 */
async function print(
  settings: PrinterSettings,
  path: string,
  directBody: unknown,
  relayInput: Parameters<typeof callRelay>[0],
): Promise<PrintResult> {
  if (directWouldBeBlocked(settings.agentUrl ?? "http://localhost:9200")) {
    return callRelay(relayInput);
  }
  const direct = await callAgentDirect(settings, path, directBody);
  if (direct.ok || direct.reason === "config" || direct.reason === "printer") {
    return direct;
  }
  const relay = await callRelay(relayInput);
  // If the relay has nothing connected either, the original "agent unreachable"
  // message is the more actionable one for someone standing at the till.
  return relay.ok || relay.reason !== "offline" ? relay : direct;
}

/** Formats and prints a full receipt. */
export function printReceipt(
  settings: PrinterSettings,
  receipt: Receipt,
): Promise<PrintResult> {
  return print(
    settings,
    "/print",
    { connection: settings, receipt },
    { kind: "receipt", connection: settings, receipt },
  );
}

/** Prints a Kitchen Order Ticket (typically the kitchen printer profile). */
export function printKot(
  settings: PrinterSettings,
  kot: Kot,
): Promise<PrintResult> {
  return print(
    settings,
    "/print/kot",
    { connection: settings, kot },
    { kind: "kot", connection: settings, kot },
  );
}

/** Prints a short fixed test slip — used by Settings → Printer to verify wiring. */
export function printTestReceipt(
  settings: PrinterSettings,
): Promise<PrintResult> {
  return print(
    settings,
    "/print/test",
    { connection: settings },
    { kind: "test", connection: settings },
  );
}

/** Basic reachability check for the LAN agent (no secret required — /health is open). */
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

/** Whether a relay agent is dialled in for this restaurant (Settings status). */
export async function checkRelayStatus(): Promise<{
  online: boolean;
  agents: number;
}> {
  try {
    return await api.print.status();
  } catch {
    return { online: false, agents: 0 };
  }
}

/** What the agent's OS driver reports about the installed printer. */
export interface DetectedPrinterInfo {
  printer: string;
  paperWidthMm: number;
  paperHeightMm?: number;
  paperName?: string;
  dpi?: number;
}

export type DetectResult =
  | { ok: true; info: DetectedPrinterInfo }
  | { ok: false; message: string };

/**
 * Ask the agent what paper size / dpi the OS driver says is loaded. Direct-LAN
 * only: it is a setup-time action performed at the till, and it needs no relay
 * round trip.
 */
export async function detectPrinterInfo(
  settings: PrinterSettings,
): Promise<DetectResult> {
  const agentUrl = settings.agentUrl ?? "http://localhost:9200";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);
  try {
    const res = await fetch(`${trimTrailingSlash(agentUrl)}/printer/info`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settings.agentSecret ? { "X-Agent-Secret": settings.agentSecret } : {}),
      },
      body: JSON.stringify({ connection: settings }),
      signal: controller.signal,
    });
    if (res.status === 401) {
      return { ok: false, message: "Security key doesn't match — check Settings → Printer." };
    }
    const data = (await res.json().catch(() => null)) as
      | { success?: boolean; info?: DetectedPrinterInfo; error?: string }
      | null;
    if (res.ok && data?.success && data.info) return { ok: true, info: data.info };
    return { ok: false, message: data?.error ?? "Couldn't detect the printer's paper." };
  } catch {
    return {
      ok: false,
      message: `Can't reach the print agent at ${agentUrl}. Is it running?`,
    };
  } finally {
    clearTimeout(timeout);
  }
}
