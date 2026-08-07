import {
  buildUpiPaymentUrl,
  isPaymentMethodEnabled,
  orderItemUnitPrice,
  orderSubtotal,
  type Order,
  type Payment,
  type Receipt,
  type Tenant,
} from "@amber/domain";

/**
 * The single `Receipt` builder for every print surface in the admin, shared by
 * BillingPage (pre-payment "Print Bill") and PaymentCompletePage (post-payment
 * receipt). Both must agree line-for-line — a guest who scans the printed bill
 * and then gets a receipt has to see the same numbers — so this deliberately
 * lives in one place rather than being copied per page.
 *
 * Rebuilt from the API's Order/Payment rather than from router state, which
 * doesn't survive a refresh or a direct link (see PRINT_RECEIPT_PLAN.md §6.3).
 */
export function buildReceipt(input: {
  orderId: string;
  tableId?: string;
  tableLabel: string;
  tenant: Tenant;
  order: Order;
  /**
   * The captured Payment row, or `null` for a pre-payment bill print. This is
   * the ONLY thing that decides `settled` — never a caller-supplied flag, so a
   * page can't accidentally print "paid" on a bill nobody has paid (the
   * one-sided payment rule, flow 0).
   */
  payment: Payment | null;
  /**
   * Amounts for the pre-payment case, where there is no Payment row to read
   * them off. Pass what the checkout screen is actually showing the guest
   * (BillingPage's post-loyalty-redemption totals) so the paper matches the
   * screen. Ignored once `payment` exists — the captured row always wins.
   */
  bill?: { subtotal: number; tax: number; total: number };
}): Receipt {
  const { orderId, tableId, tableLabel, tenant, order, payment, bill } = input;

  const lines = order.rounds.flatMap((round) =>
    round.items
      .filter((item) => item.status !== "cancelled")
      .map((item) => ({
        name: item.name,
        qty: item.qty,
        unitPrice: orderItemUnitPrice(item),
        modifiers: (item.modifiers ?? [])
          .map((m) => (m.textValue ? `"${m.textValue}"` : m.name))
          .filter(Boolean),
      })),
  );

  // A captured Payment row = the bill is settled; without one the receipt
  // prints "TOTAL DUE" (and the UPI QR), never claims it was paid.
  const settled = !!payment;

  // Precedence: the captured payment, else the caller's screen totals, else
  // recompute from the order. The last branch must add tax itself — reading
  // `payment?.tax ?? 0` would print a pre-payment bill with zero tax and a
  // total short by the GST the guest is about to be charged.
  const subtotal = payment?.subtotal ?? bill?.subtotal ?? orderSubtotal(order);
  const tax = payment?.tax ?? bill?.tax ?? Math.round(subtotal * tenant.taxRate);
  const total = payment?.total ?? bill?.total ?? subtotal + tax;

  // "If the restaurant takes UPI" — the QR is an invitation to pay, so it must
  // follow the tender toggle (Settings → Payments), not merely the presence of
  // a UPI id. A tenant that switched UPI off should not have a scan-to-pay QR
  // on their paper. The renderers additionally drop it once `settled`.
  const upiPaymentUrl =
    tenant.upiId && isPaymentMethodEnabled(tenant.paymentMethods, "upi")
      ? buildUpiPaymentUrl({
          upiId: tenant.upiId,
          payeeName: tenant.name,
          amountCents: total,
          note: `${tableLabel} ${settled ? "receipt" : "bill"}`,
        })
      : undefined;

  return {
    tenantName: tenant.name,
    address: tenant.address,
    phone: tenant.phone,
    gstNumber: tenant.gstNumber,
    fssaiNumber: tenant.fssaiNumber,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    tableLabel,
    checkNumber: (tableId ?? orderId).slice(-6).toUpperCase(),
    createdAt: payment?.createdAt ?? order.closedAt ?? new Date().toISOString(),
    lines,
    subtotal,
    taxRate: tenant.taxRate,
    settled,
    tax,
    gratuity: payment?.tip,
    total,
    // Left undefined pre-payment: there is no method yet, and both renderers
    // only print this line when `settled`.
    method: payment?.method,
    tendered: payment?.tendered,
    change:
      payment?.tendered !== undefined
        ? Math.max(0, payment.tendered - total)
        : undefined,
    currency: tenant.currency,
    footerMessage: tenant.printer.footerMessage ?? "Thank you for dining with us!",
    logoUrl: tenant.theme.logoUrl,
    upiPaymentUrl,
    reviewUrl: tenant.theme.reviewLink,
    sections: tenant.printer.sections,
  };
}
