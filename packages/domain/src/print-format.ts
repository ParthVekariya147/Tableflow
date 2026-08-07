import {
  paperWidthToMm,
  printerDotsPerMm,
  printerMarginsMm,
  type PrinterSettings,
} from "./printer.js";

/**
 * Text-layout for printed receipts/KOTs, shared by the print agent's two
 * render paths (ESC/POS + TSPL) AND the admin Settings → Printer live
 * preview — one implementation, so the on-screen preview is character-for-
 * character what the printer produces.
 */

/**
 * Amounts print as plain numbers ("656.25") — no currency code or symbol.
 * Thermal charsets can't print "₹", and a leading "INR " both wastes column
 * space and reads noisier than the plain bills staff are used to.
 */
export function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Word-wrap to `width` columns; a single over-long word is hard-split. */
export function wrapText(value: string, width: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (let word of words) {
    while (word.length > width) {
      if (current) lines.push(current);
      lines.push(word.slice(0, width));
      word = word.slice(width);
      current = "";
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length <= width) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

/**
 * One "label ......... value" line. The label is what gets truncated when the
 * line is too tight — the value (an amount) is never dropped. (Truncating
 * from the right used to silently cut the price off long item names.)
 */
export function labelValueRow(
  label: string,
  value: string,
  width: number,
): string {
  const maxLabel = Math.max(1, width - value.length - 1);
  const trimmed = label.length > maxLabel ? label.slice(0, maxLabel) : label;
  const space = Math.max(1, width - trimmed.length - value.length);
  return `${trimmed}${" ".repeat(space)}${value}`;
}

/**
 * The line-items block is a real table — the conventional Indian POS bill
 * layout (Petpooja et al.):
 *
 *   Item              Qty   Price  Amount
 *   --------------------------------------
 *   Paneer Butter       2  280.00  560.00
 *   Masala
 *
 * Fixed right-aligned Qty/Price/Amount columns; the item name wraps inside
 * its own column. Narrow rolls (< 34 chars) drop the unit-Price column so
 * the name keeps usable space.
 */
export interface ItemTableColumns {
  item: number;
  qty: number;
  /** 0 = the unit-price column is dropped (roll too narrow). */
  price: number;
  amount: number;
}

export function itemTableColumns(width: number): ItemTableColumns {
  const qty = 3;
  const amount = 8;
  const price = width >= 34 ? 7 : 0;
  const gaps = price ? 3 : 2;
  return {
    item: Math.max(8, width - qty - price - amount - gaps),
    qty,
    price,
    amount,
  };
}

export function itemTableHeader(width: number): string {
  const c = itemTableColumns(width);
  const cells = ["Item".padEnd(c.item), "Qty".padStart(c.qty)];
  if (c.price) cells.push("Price".padStart(c.price));
  cells.push("Amount".padStart(c.amount));
  return cells.join(" ");
}

export function itemTableRows(
  line: { name: string; qty: number; unitPrice: number },
  width: number,
): string[] {
  const c = itemTableColumns(width);
  const [first = "", ...rest] = wrapText(line.name, c.item);
  const cells = [first.padEnd(c.item), String(line.qty).padStart(c.qty)];
  if (c.price) cells.push(formatAmount(line.unitPrice).padStart(c.price));
  cells.push(formatAmount(line.qty * line.unitPrice).padStart(c.amount));
  return [cells.join(" "), ...rest];
}

/**
 * Tax lines for the totals block. A GST-registered restaurant (gstNumber
 * set) shows the statutory CGST/SGST split — each half the rate, summing
 * exactly to the captured tax; otherwise one plain Tax line.
 */
export function taxRows(
  taxRate: number,
  tax: number,
  gstRegistered: boolean,
): [label: string, value: string][] {
  const pct = (rate: number) => `${Number((rate * 100).toFixed(2))}%`;
  if (!gstRegistered) return [[`Tax (${pct(taxRate)})`, formatAmount(tax)]];
  const cgst = Math.floor(tax / 2);
  return [
    [`CGST (${pct(taxRate / 2)})`, formatAmount(cgst)],
    [`SGST (${pct(taxRate / 2)})`, formatAmount(tax - cgst)],
  ];
}

/** Whether this connection should be driven with TSPL (TSC label printers
 *  such as the DA310) rather than ESC/POS. `auto` sniffs the target name. */
export function shouldUseTspl(settings: PrinterSettings): boolean {
  if (settings.commandLanguage === "tspl") return true;
  if (settings.commandLanguage === "escpos") return false;
  const target = [settings.usbPath, settings.bluetoothPort, settings.networkHost]
    .filter(Boolean)
    .join(" ");
  return /\btsc\b|da310/i.test(target);
}

/** TSC bitmap font "3" char width in dots (dpi-independent — it's a bitmap,
 *  so at 300 dpi the same 16-dot glyph simply prints physically smaller). */
export const TSPL_FONT_DOTS = 16;
/** Standard ESC/POS column counts for the common rolls; any other width is
 *  derived from 12-dot Font A characters at 203 dpi with ~4mm side margins. */
const ESCPOS_COLUMNS: Record<number, number> = { 58: 32, 76: 42, 80: 48 };

/**
 * Characters per printed line for this connection — the width every layout
 * helper above should be given. Depends on the roll width, the command
 * language (TSC font 3 chars are wider than ESC/POS Font A) and — for TSPL —
 * the print head's real dpi + the configured side margins: dot math done at
 * the wrong density prints a full-width layout in a fraction of the paper.
 */
export function printerColumns(settings: PrinterSettings): number {
  const mm = paperWidthToMm(settings.paperWidth);
  if (shouldUseTspl(settings)) {
    const dotsPerMm = printerDotsPerMm(settings);
    const margins = printerMarginsMm(settings);
    const usableDots = (mm - margins.left - margins.right) * dotsPerMm;
    return Math.max(16, Math.floor(usableDots / TSPL_FONT_DOTS));
  }
  return ESCPOS_COLUMNS[mm] ?? Math.max(24, Math.floor(((mm - 8) * 8) / 12));
}
