import type { ThermalPrinter } from "node-thermal-printer";
import {
  formatAmount,
  itemTableHeader,
  itemTableRows,
  labelValueRow,
  mergeReceiptSections,
  taxRows,
  wrapText,
  type Receipt,
  type ReceiptSectionType,
} from "@amber/domain";

type SectionRenderer = (printer: ThermalPrinter, receipt: Receipt) => void | Promise<void>;

function row(printer: ThermalPrinter, label: string, value: string): void {
  printer.println(labelValueRow(label, value, printer.getWidth()));
}

/** Logo image is decorative — pngjs (node-thermal-printer's image backend)
 *  only reads PNG, and a fetch/format failure shouldn't block the rest of
 *  the receipt from printing, so failures here are swallowed. */
const renderLogo: SectionRenderer = async (printer, receipt) => {
  if (!receipt.logoUrl) return;
  try {
    const res = await fetch(receipt.logoUrl);
    if (!res.ok) return;
    const buffer = Buffer.from(await res.arrayBuffer());
    printer.alignCenter();
    await printer.printImageBuffer(buffer);
  } catch {
    /* logo is best-effort */
  }
};

/** Restaurant identity block, all centered: name, address, phone, then the
 *  statutory registration lines (GSTIN / FSSAI) — the standard bill header. */
const renderHeader: SectionRenderer = (printer, receipt) => {
  printer.alignCenter();
  printer.bold(true);
  printer.println(receipt.tenantName);
  printer.bold(false);
  if (receipt.address)
    for (const line of wrapText(receipt.address, printer.getWidth()))
      printer.println(line);
  if (receipt.phone) printer.println(`Ph: ${receipt.phone}`);
  if (receipt.gstNumber) printer.println(`GSTIN: ${receipt.gstNumber}`);
  if (receipt.fssaiNumber) printer.println(`FSSAI: ${receipt.fssaiNumber}`);
};

const renderOrderInfo: SectionRenderer = (printer, receipt) => {
  printer.alignCenter();
  printer.println(`${receipt.tableLabel} - Check #${receipt.checkNumber}`);
  printer.println(new Date(receipt.createdAt).toLocaleString());
  printer.drawLine();
};

/** Guest name/phone captured at reservation — prints nothing for walk-ins. */
const renderCustomerInfo: SectionRenderer = (printer, receipt) => {
  if (!receipt.customerName && !receipt.customerPhone) return;
  printer.alignLeft();
  if (receipt.customerName) printer.println(`Name: ${receipt.customerName}`);
  if (receipt.customerPhone) printer.println(`Ph: ${receipt.customerPhone}`);
  printer.drawLine();
};

const renderLineItems: SectionRenderer = (printer, receipt) => {
  printer.alignLeft();
  const width = printer.getWidth();
  printer.println(itemTableHeader(width));
  printer.drawLine();
  for (const line of receipt.lines) {
    for (const out of itemTableRows(line, width)) printer.println(out);
    for (const modifier of line.modifiers) printer.println(`  ${modifier}`);
  }
  printer.drawLine();
};

const renderTotals: SectionRenderer = (printer, receipt) => {
  printer.alignLeft();
  const totalQty = receipt.lines.reduce((s, l) => s + l.qty, 0);
  row(printer, "Total Qty", String(totalQty));
  row(printer, "Subtotal", formatAmount(receipt.subtotal));
  for (const [label, value] of taxRows(receipt.taxRate, receipt.tax, !!receipt.gstNumber))
    row(printer, label, value);
  if (receipt.gratuity) row(printer, "Gratuity", formatAmount(receipt.gratuity));
  printer.bold(true);
  row(printer, receipt.settled ? "TOTAL" : "TOTAL DUE", formatAmount(receipt.total));
  printer.bold(false);
};

/** Nothing to report on an unpaid bill — only prints once `settled`. */
const renderPaymentMethod: SectionRenderer = (printer, receipt) => {
  if (!receipt.settled || !receipt.method) return;
  printer.alignLeft();
  printer.println(`Paid via ${receipt.method.toUpperCase()}`);
  if (receipt.tendered !== undefined) row(printer, "Tendered", formatAmount(receipt.tendered));
  if (receipt.change !== undefined) row(printer, "Change", formatAmount(receipt.change));
};

/**
 * Auto-suppressed once the bill is `settled` — regardless of the section
 * toggle, paying an already-paid order again makes no sense. The toggle
 * controls whether the *feature* is on at all; this is the runtime guard on
 * top of it (see receiptSchema.settled).
 */
const renderUpiQr: SectionRenderer = (printer, receipt) => {
  if (receipt.settled || !receipt.upiPaymentUrl) return;
  printer.newLine();
  printer.alignCenter();
  printer.printQR(receipt.upiPaymentUrl, { cellSize: 6, correction: "M" });
  printer.println("Scan to pay via UPI");
};

const renderReviewQr: SectionRenderer = (printer, receipt) => {
  if (!receipt.reviewUrl) return;
  printer.newLine();
  printer.alignCenter();
  printer.printQR(receipt.reviewUrl, { cellSize: 6, correction: "M" });
  printer.println("Scan to rate your experience");
};

const renderFooter: SectionRenderer = (printer, receipt) => {
  if (!receipt.footerMessage) return;
  printer.newLine();
  printer.alignCenter();
  printer.println(receipt.footerMessage);
};

const RENDERERS: Record<ReceiptSectionType, SectionRenderer> = {
  logo: renderLogo,
  header: renderHeader,
  orderInfo: renderOrderInfo,
  customerInfo: renderCustomerInfo,
  lineItems: renderLineItems,
  totals: renderTotals,
  paymentMethod: renderPaymentMethod,
  upiQr: renderUpiQr,
  reviewQr: renderReviewQr,
  footer: renderFooter,
};

/**
 * Renders a `Receipt` payload onto an already-configured printer instance,
 * section by section, in the tenant's configured layout (Settings → Printer
 * → Receipt Layout) or `DEFAULT_RECEIPT_SECTIONS` if none was set. A section
 * with no backing data (e.g. `upiQr` with no `upiPaymentUrl`) just prints
 * nothing — enabling it is harmless, not an error.
 */
export async function renderReceipt(printer: ThermalPrinter, receipt: Receipt): Promise<void> {
  // Merge, don't just fall back: a saved layout from before a section type
  // existed (e.g. customerInfo) still gets the new section appended.
  const sections = mergeReceiptSections(receipt.sections);
  for (const section of sections) {
    if (!section.enabled) continue;
    await RENDERERS[section.type](printer, receipt);
  }
  printer.cut();
}
