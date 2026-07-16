import type { Response } from "express";
import { printerSettingsSchema } from "@amber/domain";
import { buildPrinter, PrinterConfigError } from "./printer/connect.js";
import { sendRawPrint } from "./printer/rawPrint.js";

/** Runs `render`, sends the job, and replies — shared by every print route
 *  (/print, /print/test, /print/kot) so all surface the same distinction
 *  between a config error (400) and an actual hardware/connect failure (502). */
export async function handlePrint(
  res: Response,
  connection: unknown,
  render: (printer: ReturnType<typeof buildPrinter>) => void | Promise<void>,
) {
  const parsedConnection = printerSettingsSchema.safeParse(connection);
  if (!parsedConnection.success) {
    res
      .status(400)
      .json({ success: false, error: "Invalid printer connection config" });
    return;
  }
  try {
    const printer = buildPrinter(parsedConnection.data);
    await render(printer);
    await printer.execute();
    res.json({ success: true });
  } catch (err) {
    const isConfigError = err instanceof PrinterConfigError;
    res.status(isConfigError ? 400 : 502).json({
      success: false,
      error: err instanceof Error ? err.message : "Print failed",
    });
  }
}

export async function handleRawPrint(
  res: Response,
  connection: unknown,
  render: (
    settings: ReturnType<typeof printerSettingsSchema.parse>,
  ) => Buffer | Promise<Buffer>,
) {
  const parsedConnection = printerSettingsSchema.safeParse(connection);
  if (!parsedConnection.success) {
    res
      .status(400)
      .json({ success: false, error: "Invalid printer connection config" });
    return;
  }
  try {
    await sendRawPrint(parsedConnection.data, await render(parsedConnection.data));
    res.json({ success: true });
  } catch (err) {
    const isConfigError = err instanceof PrinterConfigError;
    res.status(isConfigError ? 400 : 502).json({
      success: false,
      error: err instanceof Error ? err.message : "Print failed",
    });
  }
}
