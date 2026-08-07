import type { Response } from "express";
import type { PrinterSettings } from "@amber/domain";
import type { buildPrinter } from "./printer/connect.js";
import { runPrint, runRawPrint, type PrintOutcome } from "./printer/execute.js";

/**
 * HTTP wrappers around the shared executor (`printer/execute.ts`). The local
 * LAN routes (/print, /print/test, /print/kot) keep their exact contract — 400
 * for a config problem, 502 for a hardware/connect failure — while the actual
 * printing is the same code the cloud relay runs.
 */
function reply(res: Response, outcome: PrintOutcome): void {
  if (outcome.ok) {
    res.json({ success: true });
    return;
  }
  res.status(outcome.reason === "config" ? 400 : 502).json({
    success: false,
    error: outcome.error ?? "Print failed",
  });
}

export async function handlePrint(
  res: Response,
  connection: unknown,
  render: (printer: ReturnType<typeof buildPrinter>) => void | Promise<void>,
) {
  reply(res, await runPrint(connection, render));
}

export async function handleRawPrint(
  res: Response,
  connection: unknown,
  render: (settings: PrinterSettings) => Buffer | Promise<Buffer>,
) {
  reply(res, await runRawPrint(connection, render));
}
