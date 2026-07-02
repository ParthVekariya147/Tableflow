import type { ThermalPrinter } from "node-thermal-printer";
import type { Kot } from "@amber/domain";

/**
 * Renders a Kitchen Order Ticket — deliberately simple compared to
 * `renderReceipt`: no prices, tax, totals, logo, or QR codes. Large,
 * unambiguous item names/quantities are what the kitchen actually needs.
 */
export function renderKot(printer: ThermalPrinter, kot: Kot): void {
  printer.alignCenter();
  printer.setTextSize(1, 1);
  printer.bold(true);
  printer.println(kot.tableLabel);
  printer.bold(false);
  printer.println(kot.roundType === "instant" ? "BRING IT" : "BRING THESE");
  printer.println(`Check #${kot.checkNumber}`);
  printer.println(new Date(kot.createdAt).toLocaleString());
  printer.drawLine();

  printer.alignLeft();
  printer.setTextSize(1, 1);
  for (const item of kot.items) {
    printer.bold(true);
    printer.println(`${item.qty}x ${item.name}`);
    printer.bold(false);
    for (const modifier of item.modifiers) printer.println(`  - ${modifier}`);
    if (item.notes) printer.println(`  Note: ${item.notes}`);
  }
  printer.drawLine();
  printer.cut();
}
