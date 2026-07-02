import { z } from "zod";

/**
 * Receipt printing runs through a small local "print agent" process (see
 * services/print-agent) that the browser calls over plain HTTP — browsers
 * can't reliably talk to USB/Bluetooth/network thermal printers directly.
 * The agent is stateless: every request carries both the receipt content and
 * the printer connection details, so this config (where the agent lives, and
 * how it should reach the actual printer) is the only state, stored per
 * tenant like `theme`/`upiId`.
 */

export const printerConnectionTypeSchema = z.enum(["usb", "bluetooth", "network"]);

/**
 * The printable blocks of a receipt, in the order they're printed. Stored as
 * an ordered array so reordering in the Settings → Printer "Receipt Layout"
 * designer is just reordering this array — no separate "position" field.
 */
export const receiptSectionTypeSchema = z.enum([
  "logo",
  "header",
  "orderInfo",
  "lineItems",
  "totals",
  "paymentMethod",
  "upiQr",
  "reviewQr",
  "footer",
]);

export const receiptSectionSchema = z.object({
  type: receiptSectionTypeSchema,
  enabled: z.boolean().default(true),
});

/** Shared default footer text — used both as the designer's placeholder and
 *  as the fallback when a tenant hasn't set a custom `footerMessage`. */
export const DEFAULT_FOOTER_MESSAGE = "Thank you for dining with us!";

/** Default layout — a conventional receipt order. QR sections default off
 *  since they need UPI/review-link config elsewhere to have any content. */
export const DEFAULT_RECEIPT_SECTIONS: readonly z.infer<typeof receiptSectionSchema>[] = [
  { type: "logo", enabled: true },
  { type: "header", enabled: true },
  { type: "orderInfo", enabled: true },
  { type: "lineItems", enabled: true },
  { type: "totals", enabled: true },
  { type: "paymentMethod", enabled: true },
  { type: "upiQr", enabled: false },
  { type: "reviewQr", enabled: false },
  { type: "footer", enabled: true },
];

export const printerSettingsSchema = z
  .object({
    /** Base URL of the local print agent, e.g. "http://localhost:9200" or a LAN IP. */
    agentUrl: z.string().url().default("http://localhost:9200"),
    /**
     * Shared secret sent as `X-Agent-Secret` on every print request. Empty/unset
     * means the agent runs in open mode — only safe when the agent and printer
     * are on the same PC as the browser. Must match the agent's `AGENT_SECRET`
     * env var.
     */
    agentSecret: z.string().optional(),
    connectionType: printerConnectionTypeSchema.default("network"),
    /** USB: OS-level printer/device identifier (e.g. "POS-80" print queue name). */
    usbPath: z.string().optional(),
    /** Bluetooth: printer paired at the OS level, exposed as a virtual serial/COM port. */
    bluetoothPort: z.string().optional(),
    /** Network: printer's own IP/hostname. */
    networkHost: z.string().optional(),
    /** Network: ESC/POS port, 9100 is the near-universal default. */
    networkPort: z.number().int().positive().default(9100),
    paperWidth: z.enum(["58mm", "80mm"]).default("80mm"),
    /** Editable free text on the "footer" section, e.g. "Thank you for dining with us!" */
    footerMessage: z.string().optional(),
    /** Ordered, toggle-able receipt layout. Falls back to DEFAULT_RECEIPT_SECTIONS if unset. */
    sections: z.array(receiptSectionSchema).optional(),
  })
  .partial();

export type PrinterConnectionType = z.infer<typeof printerConnectionTypeSchema>;
export type ReceiptSectionType = z.infer<typeof receiptSectionTypeSchema>;
export type ReceiptSection = z.infer<typeof receiptSectionSchema>;
export type PrinterSettings = z.infer<typeof printerSettingsSchema>;
