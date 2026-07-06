import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";

/** The Payment→Order graph needed to build the sales workbook (one query, no N+1). */
export type ExportPaymentRow = Prisma.PaymentGetPayload<{
  include: {
    order: {
      include: {
        table: true;
        rounds: {
          include: {
            items: {
              include: {
                modifiers: true;
                menuItem: { include: { category: true } };
              };
            };
          };
        };
      };
    };
  };
}>;

export interface SalesExportInput {
  tenantName: string;
  currency: string;
  from: Date;
  to: Date;
  generatedAt: Date;
  payments: ExportPaymentRow[];
  /** Totals for the immediately preceding equal-length window, if available —
   *  drives the Summary sheet's period-over-period deltas (mirrors the
   *  Analytics page's revenue/orders/avg-ticket deltas). */
  previousPeriod?: { revenue: number; orders: number };
}

/** `(cur - prev) / prev`, or null if there's no prior baseline to compare to. */
function delta(cur: number, prev: number): number | null {
  return prev > 0 ? (cur - prev) / prev : null;
}

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF2B2118" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  color: { argb: "FFFFFFFF" },
  bold: true,
};

/** Major-unit currency format string for ExcelJS numFmt, e.g. `"$"#,##0.00`. */
function currencyNumFmt(currency: string): string {
  const symbol =
    new Intl.NumberFormat("en-US", { style: "currency", currency })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value ?? currency;
  return `"${symbol}"#,##0.00`;
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });
  row.commit();
}

function addTable(
  sheet: ExcelJS.Worksheet,
  columns: Partial<ExcelJS.Column>[],
  rows: Record<string, unknown>[],
): void {
  sheet.columns = columns;
  styleHeaderRow(sheet.getRow(1));
  sheet.addRows(rows);
  if (rows.length) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

/**
 * Builds the multi-sheet sales report workbook: an executive Summary, a
 * Daily Sales rollup (day-wise totals), an Orders sheet (one row per
 * payment/table session), an Order Items sheet (line-item detail, the
 * table+item granularity a POS audit needs), and an Item Summary (what sold,
 * ranked by revenue). Pure builder — all data is passed in, no I/O here.
 */
export async function buildSalesWorkbook(
  input: SalesExportInput,
): Promise<ExcelJS.Workbook> {
  const { tenantName, currency, from, to, generatedAt, payments, previousPeriod } =
    input;
  const moneyFmt = currencyNumFmt(currency);
  const toMajor = (minor: number) => minor / 100;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Amber POS";
  workbook.created = generatedAt;

  // ---- Summary ------------------------------------------------------------
  const revenue = payments.reduce((s, p) => s + p.total, 0);
  const orderCount = payments.length;
  const avgTicket = orderCount ? revenue / orderCount : 0;
  const itemRows = payments.flatMap((p) =>
    p.order.rounds.flatMap((r) =>
      r.items.filter((i) => i.status !== "cancelled"),
    ),
  );
  const totalItems = itemRows.reduce((s, i) => s + i.qty, 0);

  const summary = workbook.addWorksheet("Summary");
  summary.columns = [
    { key: "label", width: 28 },
    { key: "value", width: 28 },
  ];
  const summaryRows: [string, string | number][] = [
    ["Restaurant", tenantName],
    ["Report", "Sales Report"],
    ["Period", `${from.toLocaleString()} – ${to.toLocaleString()}`],
    ["Generated", generatedAt.toLocaleString()],
    ["", ""],
    ["Total Orders", orderCount],
    ["Total Revenue", toMajor(revenue)],
    ["Average Order Value", toMajor(avgTicket)],
    ["Total Items Sold", totalItems],
  ];
  const moneyRowIndices = [7, 8]; // "Total Revenue" / "Average Order Value"
  const pctRowIndices: number[] = [];
  if (previousPeriod) {
    const prevAvg = previousPeriod.orders
      ? previousPeriod.revenue / previousPeriod.orders
      : 0;
    summaryRows.push(
      ["", ""],
      ["vs. Previous Period", ""],
      ["Revenue Change", delta(revenue, previousPeriod.revenue) ?? "N/A"],
      ["Orders Change", delta(orderCount, previousPeriod.orders) ?? "N/A"],
      ["Avg Order Value Change", delta(avgTicket, prevAvg) ?? "N/A"],
    );
    pctRowIndices.push(
      summaryRows.length - 2,
      summaryRows.length - 1,
      summaryRows.length,
    );
  }
  summary.addRows(summaryRows);
  summary.getColumn("label").font = { bold: true };
  for (const r of moneyRowIndices) summary.getCell(`B${r}`).numFmt = moneyFmt;
  for (const r of pctRowIndices) summary.getCell(`B${r}`).numFmt = "+0.0%;-0.0%;0.0%";
  summary.getRow(1).font = { bold: true, size: 14 };
  if (previousPeriod) summary.getCell(`A${summaryRows.length - 3}`).font = { bold: true };

  // ---- Daily Sales (day-wise totals) ---------------------------------------
  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const dayAgg = new Map<
    string,
    { date: string; orders: number; items: number; revenue: number }
  >();
  for (const p of payments) {
    const key = dayKey(p.createdAt);
    const bucket =
      dayAgg.get(key) ?? { date: key, orders: 0, items: 0, revenue: 0 };
    bucket.orders += 1;
    bucket.revenue += p.total;
    bucket.items += p.order.rounds
      .flatMap((r) => r.items)
      .filter((i) => i.status !== "cancelled")
      .reduce((s, i) => s + i.qty, 0);
    dayAgg.set(key, bucket);
  }
  const dailySheet = workbook.addWorksheet("Daily Sales");
  addTable(
    dailySheet,
    [
      { header: "Date", key: "date", width: 14 },
      { header: "Orders", key: "orders", width: 12 },
      { header: "Items Sold", key: "items", width: 14 },
      { header: "Revenue", key: "revenue", width: 16 },
      { header: "Avg Order Value", key: "avg", width: 18 },
    ],
    [...dayAgg.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        date: d.date,
        orders: d.orders,
        items: d.items,
        revenue: toMajor(d.revenue),
        avg: toMajor(d.orders ? d.revenue / d.orders : 0),
      })),
  );
  dailySheet.getColumn("revenue").numFmt = moneyFmt;
  dailySheet.getColumn("avg").numFmt = moneyFmt;

  // ---- Orders (one row per table session / payment) ------------------------
  const ordersSheet = workbook.addWorksheet("Orders");
  addTable(
    ordersSheet,
    [
      { header: "Date", key: "date", width: 20 },
      { header: "Order ID", key: "orderId", width: 26 },
      { header: "Table", key: "table", width: 12 },
      { header: "Payment Method", key: "method", width: 16 },
      { header: "Subtotal", key: "subtotal", width: 14 },
      { header: "Tax", key: "tax", width: 12 },
      { header: "Tip", key: "tip", width: 12 },
      { header: "Total", key: "total", width: 14 },
    ],
    payments.map((p) => ({
      date: p.createdAt.toLocaleString(),
      orderId: p.orderId,
      table: p.order.table.label,
      method: p.method,
      subtotal: toMajor(p.subtotal),
      tax: toMajor(p.tax),
      tip: toMajor(p.tip),
      total: toMajor(p.total),
    })),
  );
  for (const key of ["subtotal", "tax", "tip", "total"])
    ordersSheet.getColumn(key).numFmt = moneyFmt;

  // ---- Order Items (line-item detail) --------------------------------------
  const itemDetailRows = payments.flatMap((p) =>
    p.order.rounds.flatMap((r) =>
      r.items
        .filter((i) => i.status !== "cancelled")
        .map((i) => {
          const unit =
            i.unitPrice + i.modifiers.reduce((s, m) => s + m.priceDelta, 0);
          const modifiers = i.modifiers
            .map((m) =>
              m.textValue
                ? `${m.groupName}: ${m.textValue}`
                : `${m.groupName}: ${m.name}${m.priceDelta ? ` (+${toMajor(m.priceDelta).toFixed(2)})` : ""}`,
            )
            .join("; ");
          return {
            date: p.createdAt.toLocaleString(),
            orderId: p.orderId,
            table: p.order.table.label,
            item: i.name,
            category: i.menuItem?.category?.name ?? "Other",
            qty: i.qty,
            unitPrice: toMajor(unit),
            lineTotal: toMajor(unit * i.qty),
            modifiers,
            notes: i.notes ?? "",
          };
        }),
    ),
  );
  const itemsSheet = workbook.addWorksheet("Order Items");
  addTable(
    itemsSheet,
    [
      { header: "Date", key: "date", width: 20 },
      { header: "Order ID", key: "orderId", width: 26 },
      { header: "Table", key: "table", width: 10 },
      { header: "Item", key: "item", width: 26 },
      { header: "Category", key: "category", width: 16 },
      { header: "Qty", key: "qty", width: 8 },
      { header: "Unit Price", key: "unitPrice", width: 14 },
      { header: "Line Total", key: "lineTotal", width: 14 },
      { header: "Modifiers", key: "modifiers", width: 36 },
      { header: "Notes", key: "notes", width: 24 },
    ],
    itemDetailRows,
  );
  itemsSheet.getColumn("unitPrice").numFmt = moneyFmt;
  itemsSheet.getColumn("lineTotal").numFmt = moneyFmt;

  // ---- Item Summary (what sold, ranked by revenue) --------------------------
  const itemAgg = new Map<
    string,
    { name: string; category: string; qty: number; revenue: number }
  >();
  for (const row of itemDetailRows) {
    const bucket =
      itemAgg.get(row.item) ??
      { name: row.item, category: row.category, qty: 0, revenue: 0 };
    bucket.qty += row.qty;
    bucket.revenue += row.lineTotal;
    itemAgg.set(row.item, bucket);
  }
  const itemTotalRevenue = [...itemAgg.values()].reduce(
    (s, i) => s + i.revenue,
    0,
  );
  const itemSummarySheet = workbook.addWorksheet("Item Summary");
  addTable(
    itemSummarySheet,
    [
      { header: "Item", key: "name", width: 26 },
      { header: "Category", key: "category", width: 16 },
      { header: "Qty Sold", key: "qty", width: 12 },
      { header: "Revenue", key: "revenue", width: 16 },
      { header: "% of Total", key: "pct", width: 12 },
    ],
    [...itemAgg.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .map((i) => ({
        name: i.name,
        category: i.category,
        qty: i.qty,
        revenue: i.revenue,
        pct: itemTotalRevenue ? i.revenue / itemTotalRevenue : 0,
      })),
  );
  itemSummarySheet.getColumn("revenue").numFmt = moneyFmt;
  itemSummarySheet.getColumn("pct").numFmt = "0.0%";

  // ---- Category Split (revenue by menu category) ----------------------------
  const catAgg = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const row of itemDetailRows) {
    const bucket =
      catAgg.get(row.category) ?? { name: row.category, qty: 0, revenue: 0 };
    bucket.qty += row.qty;
    bucket.revenue += row.lineTotal;
    catAgg.set(row.category, bucket);
  }
  const categorySheet = workbook.addWorksheet("Category Split");
  addTable(
    categorySheet,
    [
      { header: "Category", key: "name", width: 20 },
      { header: "Qty Sold", key: "qty", width: 12 },
      { header: "Revenue", key: "revenue", width: 16 },
      { header: "% of Total", key: "pct", width: 12 },
    ],
    [...catAgg.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .map((c) => ({
        name: c.name,
        qty: c.qty,
        revenue: c.revenue,
        pct: itemTotalRevenue ? c.revenue / itemTotalRevenue : 0,
      })),
  );
  categorySheet.getColumn("revenue").numFmt = moneyFmt;
  categorySheet.getColumn("pct").numFmt = "0.0%";

  // ---- Peak Hours (orders settled per hour-of-day) ---------------------------
  const hourCounts = new Array(24).fill(0) as number[];
  const hourRevenue = new Array(24).fill(0) as number[];
  for (const p of payments) {
    const h = p.createdAt.getHours();
    hourCounts[h] = (hourCounts[h] ?? 0) + 1;
    hourRevenue[h] = (hourRevenue[h] ?? 0) + p.total;
  }
  const hourLabel = (h: number) =>
    new Date(2000, 0, 1, h).toLocaleTimeString("en-US", { hour: "numeric" });
  const peakHoursSheet = workbook.addWorksheet("Peak Hours");
  addTable(
    peakHoursSheet,
    [
      { header: "Hour", key: "hour", width: 12 },
      { header: "Orders", key: "orders", width: 12 },
      { header: "Revenue", key: "revenue", width: 16 },
    ],
    hourCounts.map((orders, h) => ({
      hour: hourLabel(h),
      orders,
      revenue: toMajor(hourRevenue[h] ?? 0),
    })),
  );
  peakHoursSheet.getColumn("revenue").numFmt = moneyFmt;

  return workbook;
}
