import type { ThermalPrinter } from "node-thermal-printer";
import {
  DEFAULT_RECEIPT_SECTIONS,
  formatMoney,
  type Receipt,
  type ReceiptSectionType,
} from "@amber/domain";

type SectionRenderer = (printer: ThermalPrinter, receipt: Receipt) => void | Promise<void>;

function money(receipt: Receipt, cents: number): string {
  return formatMoney(cents, receipt.currency);
}

function row(printer: ThermalPrinter, label: string, value: string): void {
  printer.tableCustom([
    { text: label, align: "LEFT", width: 0.6 },
    { text: value, align: "RIGHT", width: 0.4 },
  ]);
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

const renderHeader: SectionRenderer = (printer, receipt) => {
  printer.alignCenter();
  printer.bold(true);
  printer.println(receipt.tenantName);
  printer.bold(false);
  if (receipt.gstNumber) printer.println(`GST: ${receipt.gstNumber}`);
};

const renderOrderInfo: SectionRenderer = (printer, receipt) => {
  printer.alignCenter();
  printer.println(`${receipt.tableLabel} - Check #${receipt.checkNumber}`);
  printer.println(new Date(receipt.createdAt).toLocaleString());
  printer.drawLine();
};

const renderLineItems: SectionRenderer = (printer, receipt) => {
  printer.alignLeft();
  for (const line of receipt.lines) {
    row(printer, `${line.qty}x ${line.name}`, money(receipt, line.unitPrice * line.qty));
    for (const modifier of line.modifiers) printer.println(`  ${modifier}`);
  }
  printer.drawLine();
};

const renderTotals: SectionRenderer = (printer, receipt) => {
  row(printer, "Subtotal", money(receipt, receipt.subtotal));
  row(printer, `Tax (${(receipt.taxRate * 100).toFixed(1)}%)`, money(receipt, receipt.tax));
  if (receipt.gratuity) row(printer, "Gratuity", money(receipt, receipt.gratuity));
  printer.bold(true);
  row(printer, receipt.settled ? "TOTAL" : "TOTAL DUE", money(receipt, receipt.total));
  printer.bold(false);
};

/** Nothing to report on an unpaid bill — only prints once `settled`. */
const renderPaymentMethod: SectionRenderer = (printer, receipt) => {
  if (!receipt.settled || !receipt.method) return;
  printer.println(`Paid via ${receipt.method.toUpperCase()}`);
  if (receipt.tendered !== undefined) row(printer, "Tendered", money(receipt, receipt.tendered));
  if (receipt.change !== undefined) row(printer, "Change", money(receipt, receipt.change));
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
  const sections = receipt.sections?.length ? receipt.sections : DEFAULT_RECEIPT_SECTIONS;
  for (const section of sections) {
    if (!section.enabled) continue;
    await RENDERERS[section.type](printer, receipt);
  }
  printer.cut();
}
