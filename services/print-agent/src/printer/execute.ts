import { printerSettingsSchema, type PrinterSettings } from "@amber/domain";
import { buildPrinter, PrinterConfigError } from "./connect.js";
import { sendRawPrint } from "./rawPrint.js";

/**
 * Transport-agnostic print execution. Both the local HTTP routes and the cloud
 * relay client run jobs through here, so a receipt printed from a phone (via
 * the relay) is byte-identical to one printed from the till (via LAN) — same
 * renderers, same connection handling, same error classification.
 *
 * `config` vs `printer` mirrors the HTTP routes' 400-vs-502 split: a config
 * error means the tenant must fix Settings → Printer, a printer error means
 * check the hardware.
 */
export interface PrintOutcome {
  ok: boolean;
  reason?: "config" | "printer";
  error?: string;
}

const OK: PrintOutcome = { ok: true };

function classify(err: unknown): PrintOutcome {
  const isConfig = err instanceof PrinterConfigError;
  return {
    ok: false,
    reason: isConfig ? "config" : "printer",
    error: err instanceof Error ? err.message : "Print failed",
  };
}

/** ESC/POS path — render through node-thermal-printer, then execute. */
export async function runPrint(
  connection: unknown,
  render: (printer: ReturnType<typeof buildPrinter>) => void | Promise<void>,
): Promise<PrintOutcome> {
  const parsed = printerSettingsSchema.safeParse(connection);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "config",
      error: "Invalid printer connection config",
    };
  }
  try {
    const printer = buildPrinter(parsed.data);
    await render(printer);
    await printer.execute();
    return OK;
  } catch (err) {
    return classify(err);
  }
}

/** TSPL/raw path — build the command buffer, then send the bytes. */
export async function runRawPrint(
  connection: unknown,
  render: (settings: PrinterSettings) => Buffer | Promise<Buffer>,
): Promise<PrintOutcome> {
  const parsed = printerSettingsSchema.safeParse(connection);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "config",
      error: "Invalid printer connection config",
    };
  }
  try {
    await sendRawPrint(parsed.data, await render(parsed.data));
    return OK;
  } catch (err) {
    return classify(err);
  }
}
