import { describe, expect, it } from "vitest";
import {
  formatAmount,
  itemTableColumns,
  itemTableHeader,
  itemTableRows,
  labelValueRow,
  printerColumns,
  shouldUseTspl,
  taxRows,
  wrapText,
} from "../src/print-format";
import {
  mergeReceiptSections,
  paperWidthToMm,
  printerSettingsSchema,
} from "../src/printer";

describe("formatAmount", () => {
  it("prints plain numbers — no currency code or symbol", () => {
    expect(formatAmount(65625)).toBe("656.25");
    expect(formatAmount(0)).toBe("0.00");
    expect(formatAmount(5)).toBe("0.05");
  });
});

describe("labelValueRow", () => {
  it("right-aligns the value at exactly the line width", () => {
    const row = labelValueRow("Subtotal", "820.00", 26);
    expect(row).toHaveLength(26);
    expect(row.startsWith("Subtotal")).toBe(true);
    expect(row.endsWith("820.00")).toBe(true);
  });

  it("truncates the label, never the value, when the line is too tight", () => {
    const row = labelValueRow(
      "A ridiculously long label that cannot fit",
      "861.00",
      26,
    );
    expect(row).toHaveLength(26);
    expect(row.endsWith(" 861.00")).toBe(true);
  });
});

describe("item table (Item | Qty | Price | Amount)", () => {
  const long = {
    name: "Paneer Butter Masala Special Full Plate",
    qty: 2,
    unitPrice: 28000,
  };

  it("keeps every column on the exact grid at full width", () => {
    const header = itemTableHeader(48);
    const rows = itemTableRows(long, 48);
    expect(header).toHaveLength(48);
    expect(rows[0]).toHaveLength(48);
    // Right-aligned columns end at the same character position as the header.
    const c = itemTableColumns(48);
    const qtyEnd = c.item + 1 + c.qty;
    const priceEnd = qtyEnd + 1 + c.price;
    expect(header.endsWith("Amount")).toBe(true);
    expect(rows[0]?.endsWith("560.00")).toBe(true);
    expect(header.slice(0, qtyEnd).endsWith("Qty")).toBe(true);
    expect(rows[0]?.slice(0, qtyEnd).endsWith("2")).toBe(true);
    expect(header.slice(0, priceEnd).endsWith("Price")).toBe(true);
    expect(rows[0]?.slice(0, priceEnd).endsWith("280.00")).toBe(true);
  });

  it("wraps a long name inside the item column, never into the numbers", () => {
    const { item } = itemTableColumns(32);
    const rows = itemTableRows(long, 32);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows.slice(1)) {
      expect(row.length).toBeLessThanOrEqual(item);
    }
    const joined = rows.join(" ").replace(/\s+/g, " ");
    expect(joined).toContain("Full Plate");
    expect(rows[0]?.endsWith("560.00")).toBe(true);
  });

  it("drops the unit-price column on narrow rolls (< 34 chars)", () => {
    expect(itemTableColumns(26).price).toBe(0);
    expect(itemTableHeader(26)).not.toContain("Price");
    expect(itemTableHeader(26)).toHaveLength(26);
    expect(itemTableColumns(48).price).toBeGreaterThan(0);
  });

  it("puts the quantity in its own column", () => {
    const rows = itemTableRows(
      { name: "Garlic Naan", qty: 4, unitPrice: 6500 },
      48,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe(
      "Garlic Naan                   4   65.00   260.00",
    );
    expect(rows[0]).toHaveLength(48);
  });
});

describe("wrapText", () => {
  it("wraps on word boundaries and hard-splits over-long words", () => {
    expect(wrapText("Thank you for dining with us!", 26)).toEqual([
      "Thank you for dining with",
      "us!",
    ]);
    expect(wrapText("Supercalifragilistic", 10)).toEqual([
      "Supercalif",
      "ragilistic",
    ]);
    expect(wrapText("", 10)).toEqual([""]);
  });
});

describe("shouldUseTspl", () => {
  it("honours an explicit language and sniffs TSC names on auto", () => {
    expect(shouldUseTspl({ commandLanguage: "tspl" })).toBe(true);
    expect(
      shouldUseTspl({ commandLanguage: "escpos", usbPath: "TSC DA310" }),
    ).toBe(false);
    expect(
      shouldUseTspl({ commandLanguage: "auto", usbPath: "TSC DA310" }),
    ).toBe(true);
    expect(
      shouldUseTspl({ commandLanguage: "auto", usbPath: "POS-80" }),
    ).toBe(false);
  });
});

describe("printerColumns", () => {
  it("scales with the paper width on both languages", () => {
    const tspl = (paperWidth: string) =>
      printerColumns({ commandLanguage: "tspl", paperWidth });
    const escpos = (paperWidth: string) =>
      printerColumns({ commandLanguage: "escpos", paperWidth });

    expect(tspl("58mm")).toBe(26);
    expect(tspl("80mm")).toBe(37);
    expect(tspl("101mm")).toBe(47);

    expect(escpos("58mm")).toBe(32);
    expect(escpos("76mm")).toBe(42);
    expect(escpos("80mm")).toBe(48);
    expect(escpos("101mm")).toBe(62);
  });

  it("uses the head's real dpi and the configured margins on TSPL", () => {
    // 300 dpi: ~11.8 dots/mm, so a 101mm roll fits far more 16-dot chars
    // than the 203-dpi assumption (which printed in only ~68mm of paper).
    expect(
      printerColumns({ commandLanguage: "tspl", paperWidth: "101mm", dpi: 300 }),
    ).toBe(70);
    // Unset dpi sniffs the device name — the DA310 is a 300-dpi model.
    expect(
      printerColumns({
        commandLanguage: "tspl",
        paperWidth: "101mm",
        usbPath: "TSC DA310",
      }),
    ).toBe(70);
    // Wider side margins shrink the printable band.
    expect(
      printerColumns({
        commandLanguage: "tspl",
        paperWidth: "101mm",
        dpi: 300,
        marginLeftMm: 6,
        marginRightMm: 6,
      }),
    ).toBe(65);
  });
});

describe("taxRows", () => {
  it("prints a single Tax line for non-GST tenants", () => {
    expect(taxRows(0.05, 4500, false)).toEqual([["Tax (5%)", "45.00"]]);
  });

  it("splits into CGST/SGST for GST-registered tenants, summing exactly", () => {
    expect(taxRows(0.05, 4500, true)).toEqual([
      ["CGST (2.5%)", "22.50"],
      ["SGST (2.5%)", "22.50"],
    ]);
    // Odd paise: the two halves still add up to the captured tax.
    expect(taxRows(0.05, 4501, true)).toEqual([
      ["CGST (2.5%)", "22.50"],
      ["SGST (2.5%)", "22.51"],
    ]);
  });
});

describe("mergeReceiptSections", () => {
  it("appends section types missing from a saved layout", () => {
    const saved = [
      { type: "header" as const, enabled: true },
      { type: "lineItems" as const, enabled: true },
    ];
    const merged = mergeReceiptSections(saved);
    // Saved order/toggles preserved, new types appended.
    expect(merged[0]).toEqual({ type: "header", enabled: true });
    expect(merged[1]).toEqual({ type: "lineItems", enabled: true });
    expect(merged.some((s) => s.type === "customerInfo")).toBe(true);
    expect(merged.some((s) => s.type === "totals")).toBe(true);
  });

  it("returns the full default layout when nothing is saved", () => {
    const merged = mergeReceiptSections(undefined);
    expect(merged.some((s) => s.type === "customerInfo")).toBe(true);
    expect(merged.length).toBeGreaterThanOrEqual(10);
  });
});

describe("paperWidth setting", () => {
  it("accepts presets and custom mm values, rejects garbage", () => {
    for (const value of ["58mm", "76mm", "80mm", "101mm", "44mm"]) {
      expect(printerSettingsSchema.safeParse({ paperWidth: value }).success).toBe(
        true,
      );
    }
    expect(printerSettingsSchema.safeParse({ paperWidth: "80" }).success).toBe(
      false,
    );
    expect(printerSettingsSchema.safeParse({ paperWidth: "8mm" }).success).toBe(
      false,
    );
  });

  it("parses to clamped millimetres with an 80mm fallback", () => {
    expect(paperWidthToMm("101mm")).toBe(101);
    expect(paperWidthToMm(undefined)).toBe(80);
    expect(paperWidthToMm("999mm")).toBe(210);
  });
});
