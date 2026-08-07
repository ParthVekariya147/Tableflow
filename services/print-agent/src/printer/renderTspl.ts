import { PNG } from "pngjs";
import {
  formatAmount,
  itemTableHeader,
  itemTableRows,
  labelValueRow,
  mergeReceiptSections,
  paperWidthToMm,
  printerColumns,
  printerDpi,
  printerDotsPerMm,
  printerMarginsMm,
  taxRows,
  wrapText,
  type Kot,
  type PrinterSettings,
  type Receipt,
} from "@amber/domain";

// Language detection lives in @amber/domain so the admin preview matches;
// re-exported here because the routes import it alongside the renderers.
export { shouldUseTspl } from "@amber/domain";

// Vertical rhythm stays in dots (it's relative to the bitmap font's dot
// height); everything horizontal is computed per-settings from the head's
// real dpi + configured margins — see tsplGeometry.
const TOP = 24;
const LINE = 34;
const FONT = "3";
/** TSC bitmap font "3" is 16 dots wide per character (for centering math). */
const FONT_DOTS = 16;

/** All dpi/margin-derived horizontal geometry for one print job. */
function tsplGeometry(settings: PrinterSettings) {
  const dotsPerMm = printerDotsPerMm(settings);
  const margins = printerMarginsMm(settings);
  const widthMm = paperWidthToMm(settings.paperWidth);
  const left = Math.round(margins.left * dotsPerMm);
  const widthDots = Math.round(widthMm * dotsPerMm);
  return {
    dotsPerMm,
    widthMm,
    widthDots,
    left,
    printableDots: Math.max(
      FONT_DOTS,
      widthDots - left - Math.round(margins.right * dotsPerMm),
    ),
    // A 300-dpi head prints the same dot-sized QR/logo physically smaller, so
    // scale the QR cell (5→7 keeps the module ~0.6mm, comfortably scannable)
    // and cap the logo by physical height, not dots.
    qrCell: printerDpi(settings) === 300 ? 7 : 5,
    logoMaxHeightDots: Math.round(30 * dotsPerMm),
  };
}

/** A printable unit: a text line, a native TSPL QRCODE with a caption, or a
 *  1-bit logo bitmap (PNG converted for the BITMAP command). */
type TsplElement =
  | { kind: "text"; text: string; center?: boolean }
  | { kind: "qr"; content: string; caption?: string }
  | {
      kind: "bitmap";
      data: Buffer;
      widthBytes: number;
      widthDots: number;
      height: number;
    };

const text = (t: string): TsplElement => ({ kind: "text", text: t });
const centered = (t: string): TsplElement => ({
  kind: "text",
  text: t,
  center: true,
});

/** Byte-mode capacity at ECC level M for QR versions 1–10; a version-v code
 *  is (17 + 4v) modules per side. Used to reserve vertical space — the
 *  printer picks the real version itself (QRCODE mode A). */
const QR_CAPACITY_M = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];

function qrSideDots(content: string, cell: number): number {
  const idx = QR_CAPACITY_M.findIndex((cap) => content.length <= cap);
  const version = idx === -1 ? QR_CAPACITY_M.length : idx + 1;
  return (17 + 4 * version) * cell;
}

/**
 * Fetch + convert the tenant's PNG logo to a 1-bit TSPL BITMAP element
 * (bit cleared = printed dot). Best-effort like the ESC/POS logo path:
 * any fetch/decode failure just drops the logo, never the receipt.
 * `maxHeightDots` caps an oversized upload so it can't eat half the label.
 */
async function logoBitmap(
  url: string,
  printableDots: number,
  maxHeightDots: number,
): Promise<TsplElement | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
    const scale = Math.min(
      1,
      printableDots / png.width,
      maxHeightDots / png.height,
    );
    const w = Math.max(1, Math.floor(png.width * scale));
    const h = Math.max(1, Math.floor(png.height * scale));
    const widthBytes = Math.ceil(w / 8);
    const data = Buffer.alloc(widthBytes * h, 0xff);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(png.height - 1, Math.floor(y / scale));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(png.width - 1, Math.floor(x / scale));
        const i = (sy * png.width + sx) * 4;
        const r = png.data[i] ?? 255;
        const g = png.data[i + 1] ?? 255;
        const b = png.data[i + 2] ?? 255;
        const alpha = png.data[i + 3] ?? 0;
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        if (alpha > 127 && luminance < 160) {
          const idx = y * widthBytes + (x >> 3);
          data[idx] = (data[idx] ?? 0xff) & ~(0x80 >> (x & 7));
        }
      }
    }
    return { kind: "bitmap", data, widthBytes, widthDots: w, height: h };
  } catch {
    return null;
  }
}

/** Characters that fit between the side margins for the configured roll. */
function maxChars(settings: PrinterSettings): number {
  return printerColumns({ ...settings, commandLanguage: "tspl" });
}

function clean(value: string): string {
  // Right-trim only — leading spaces are the indent on wrapped/modifier lines.
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/"/g, "'")
    .replace(/\s+$/, "");
}

function wrap(value: string, width: number): string[] {
  return wrapText(clean(value), width);
}

/** Wrap with a two-space indent on every line (modifiers, notes). */
function indented(value: string, width: number): string[] {
  return wrap(value, Math.max(1, width - 2)).map((line) => `  ${line}`);
}

function row(label: string, value: string, width: number): string {
  return labelValueRow(clean(label), clean(value), width);
}

function separator(width: number): string {
  return "-".repeat(width);
}

function buildTspl(
  settings: PrinterSettings,
  elements: TsplElement[],
  options: { diagnosticBar?: boolean } = {},
): Buffer {
  const geo = tsplGeometry(settings);
  const barHeight = options.diagnosticBar ? 34 : 0;

  let y = TOP + (options.diagnosticBar ? barHeight + 18 : 0);
  // Body is built as raw chunks because BITMAP data is binary, not ASCII.
  const body: Buffer[] = [];
  const cmd = (line: string) => body.push(Buffer.from(`${line}\r\n`, "ascii"));
  if (options.diagnosticBar)
    cmd(`BAR ${geo.left},${TOP},${geo.printableDots},${barHeight}`);

  const pushText = (raw: string, center?: boolean) => {
    const value = clean(raw);
    const x = center
      ? Math.max(
          geo.left,
          Math.round((geo.widthDots - value.length * FONT_DOTS) / 2),
        )
      : geo.left;
    cmd(`TEXT ${x},${y},"${FONT}",0,1,1,"${value}"`);
    y += LINE;
  };

  for (const el of elements) {
    if (el.kind === "text") {
      pushText(el.text, el.center);
      continue;
    }
    if (el.kind === "bitmap") {
      const x = Math.max(geo.left, Math.round((geo.widthDots - el.widthDots) / 2));
      body.push(
        Buffer.from(`BITMAP ${x},${y},${el.widthBytes},${el.height},0,`, "ascii"),
        el.data,
        Buffer.from("\r\n", "ascii"),
      );
      y += el.height + 14;
      continue;
    }
    // Native TSPL QRCODE — mode A picks the version; we reserve space for
    // the worst case at this content length so nothing overlaps below it.
    const content = el.content.replace(/"/g, "");
    const side = qrSideDots(content, geo.qrCell);
    const x = Math.max(geo.left, Math.round((geo.widthDots - side) / 2));
    y += 10;
    cmd(`QRCODE ${x},${y},M,${geo.qrCell},A,0,"${content}"`);
    y += side + 14;
    if (el.caption) pushText(el.caption, true);
  }

  const heightMm = Math.max(50, Math.ceil((y + TOP) / geo.dotsPerMm));
  const preamble = [
    `SIZE ${geo.widthMm} mm,${heightMm} mm`,
    "GAP 3 mm,0",
    "SPEED 2",
    "DENSITY 15",
    "SET RIBBON OFF",
    "SET TEAR ON",
    "REFERENCE 0,0",
    "DIRECTION 1",
    "CLS",
  ]
    .map((line) => `${line}\r\n`)
    .join("");
  return Buffer.concat([
    Buffer.from(preamble, "ascii"),
    ...body,
    Buffer.from("PRINT 1,1\r\n", "ascii"),
  ]);
}

export function renderTsplTest(settings: PrinterSettings): Buffer {
  const width = maxChars(settings);
  return buildTspl(
    settings,
    [
      "Amber Print Agent",
      separator(width),
      "TSC/TSPL TEST PRINT",
      new Date().toLocaleString(),
      "Printer connection OK",
    ].map(text),
    { diagnosticBar: true },
  );
}

export function renderTsplKot(settings: PrinterSettings, kot: Kot): Buffer {
  const width = maxChars(settings);
  const lines = [
    kot.tenantName,
    separator(width),
    kot.tableLabel,
    kot.roundType === "instant" ? "BRING IT" : "BRING THESE",
    `Check #${kot.checkNumber}`,
    new Date(kot.createdAt).toLocaleString(),
    separator(width),
  ];
  for (const item of kot.items) {
    lines.push(...wrap(`${item.qty}x ${item.name}`, width));
    for (const modifier of item.modifiers)
      lines.push(...indented(`- ${modifier}`, width));
    if (item.notes) lines.push(...indented(`Note: ${item.notes}`, width));
  }
  return buildTspl(settings, lines.map(text));
}

export async function renderTsplReceipt(
  settings: PrinterSettings,
  receipt: Receipt,
): Promise<Buffer> {
  const width = maxChars(settings);
  const geo = tsplGeometry({ ...settings, commandLanguage: "tspl" });
  // Merge, don't just fall back: a saved layout from before a section type
  // existed (e.g. customerInfo) still gets the new section appended.
  const sections = mergeReceiptSections(receipt.sections);
  const elements: TsplElement[] = [];
  const push = (...values: string[]) => elements.push(...values.map(text));
  const pushCentered = (...values: string[]) =>
    elements.push(...values.map(centered));

  for (const section of sections) {
    if (!section.enabled) continue;
    switch (section.type) {
      case "logo": {
        if (!receipt.logoUrl) break;
        const logo = await logoBitmap(
          receipt.logoUrl,
          geo.printableDots,
          geo.logoMaxHeightDots,
        );
        if (logo) elements.push(logo);
        break;
      }
      case "upiQr":
        // Same guard as ESC/POS: a settled bill never re-asks for payment.
        if (!receipt.settled && receipt.upiPaymentUrl) {
          elements.push({
            kind: "qr",
            content: receipt.upiPaymentUrl,
            caption: "Scan to pay via UPI",
          });
        }
        break;
      case "reviewQr":
        if (receipt.reviewUrl) {
          elements.push({
            kind: "qr",
            content: receipt.reviewUrl,
            caption: "Scan to rate your experience",
          });
        }
        break;
      case "header":
        pushCentered(receipt.tenantName);
        if (receipt.address)
          pushCentered(...wrap(receipt.address, width));
        if (receipt.phone) pushCentered(`Ph: ${receipt.phone}`);
        if (receipt.gstNumber) pushCentered(`GSTIN: ${receipt.gstNumber}`);
        if (receipt.fssaiNumber) pushCentered(`FSSAI: ${receipt.fssaiNumber}`);
        break;
      case "orderInfo":
        pushCentered(`${receipt.tableLabel} - Check #${receipt.checkNumber}`);
        pushCentered(new Date(receipt.createdAt).toLocaleString());
        push(separator(width));
        break;
      case "customerInfo":
        if (receipt.customerName || receipt.customerPhone) {
          if (receipt.customerName) push(`Name: ${receipt.customerName}`);
          if (receipt.customerPhone) push(`Ph: ${receipt.customerPhone}`);
          push(separator(width));
        }
        break;
      case "lineItems":
        push(itemTableHeader(width));
        push(separator(width));
        for (const line of receipt.lines) {
          push(...itemTableRows({ ...line, name: clean(line.name) }, width));
          for (const modifier of line.modifiers)
            push(...indented(modifier, width));
        }
        push(separator(width));
        break;
      case "totals":
        push(
          row(
            "Total Qty",
            String(receipt.lines.reduce((s, l) => s + l.qty, 0)),
            width,
          ),
        );
        push(row("Subtotal", formatAmount(receipt.subtotal), width));
        for (const [label, value] of taxRows(
          receipt.taxRate,
          receipt.tax,
          !!receipt.gstNumber,
        ))
          push(row(label, value, width));
        if (receipt.gratuity)
          push(row("Gratuity", formatAmount(receipt.gratuity), width));
        push(
          row(
            receipt.settled ? "TOTAL" : "TOTAL DUE",
            formatAmount(receipt.total),
            width,
          ),
        );
        break;
      case "paymentMethod":
        if (receipt.settled && receipt.method) {
          push(`Paid via ${receipt.method.toUpperCase()}`);
          if (receipt.tendered !== undefined)
            push(row("Tendered", formatAmount(receipt.tendered), width));
          if (receipt.change !== undefined)
            push(row("Change", formatAmount(receipt.change), width));
        }
        break;
      case "footer":
        if (receipt.footerMessage)
          pushCentered(...wrap(receipt.footerMessage, width));
        break;
    }
  }

  return buildTspl(settings, elements.length ? elements : [text("Receipt")]);
}
