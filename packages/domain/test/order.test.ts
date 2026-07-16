import { describe, expect, it } from "vitest";
import {
  ITEM_STATUS_FLOW,
  orderItemUnitPrice,
  orderSubtotal,
  orderItemSchema,
  type OrderItem,
  type Round,
} from "../src/order";

/** Build a minimal OrderItem for math tests. */
function item(overrides: Partial<OrderItem> = {}): OrderItem {
  return {
    id: "item-1",
    menuItemId: "menu-1",
    name: "Test Dish",
    unitPrice: 1000,
    qty: 1,
    status: "placed",
    modifiers: [],
    ...overrides,
  };
}

function modifier(priceDelta: number) {
  return {
    id: `mod-${priceDelta}`,
    optionId: "opt-1",
    groupName: "Extras",
    name: "Extra",
    priceDelta,
  };
}

function round(items: OrderItem[], type: Round["type"] = "bundled"): Round {
  return { id: "round-1", type, items, createdAt: "2026-07-14T10:00:00.000Z" };
}

describe("orderItemUnitPrice", () => {
  it("returns the base unit price when there are no modifiers", () => {
    expect(orderItemUnitPrice(item({ unitPrice: 1450 }))).toBe(1450);
  });

  it("adds positive modifier deltas per unit", () => {
    const i = item({ unitPrice: 1000, modifiers: [modifier(200), modifier(50)] });
    expect(orderItemUnitPrice(i)).toBe(1250);
  });

  it("applies negative deltas (discount options)", () => {
    const i = item({ unitPrice: 1000, modifiers: [modifier(-300)] });
    expect(orderItemUnitPrice(i)).toBe(700);
  });

  it("tolerates a missing modifiers array (pre-validation shapes)", () => {
    expect(
      orderItemUnitPrice({ unitPrice: 500, modifiers: undefined as never }),
    ).toBe(500);
  });
});

describe("orderSubtotal", () => {
  it("is 0 for an order with no rounds", () => {
    expect(orderSubtotal({ rounds: [] })).toBe(0);
  });

  it("multiplies the modifier-inclusive unit price by qty", () => {
    const rounds = [
      round([item({ unitPrice: 1000, qty: 2, modifiers: [modifier(100)] })]),
    ];
    // (1000 + 100) * 2
    expect(orderSubtotal({ rounds })).toBe(2200);
  });

  it("sums across multiple rounds and items", () => {
    const rounds = [
      round([item({ unitPrice: 600, qty: 1 }), item({ id: "i2", unitPrice: 850, qty: 2 })]),
      round([item({ id: "i3", unitPrice: 1400, qty: 1 })]),
    ];
    expect(orderSubtotal({ rounds })).toBe(600 + 1700 + 1400);
  });

  it("excludes cancelled lines from the subtotal", () => {
    const rounds = [
      round([
        item({ unitPrice: 1000, qty: 1 }),
        item({ id: "i2", unitPrice: 9999, qty: 3, status: "cancelled" }),
      ]),
    ];
    expect(orderSubtotal({ rounds })).toBe(1000);
  });
});

describe("ITEM_STATUS_FLOW", () => {
  it("advances placed → preparing → ready → served", () => {
    expect(ITEM_STATUS_FLOW).toEqual(["placed", "preparing", "ready", "served"]);
  });

  it("does not include cancelled (terminal, not a stage)", () => {
    expect(ITEM_STATUS_FLOW).not.toContain("cancelled");
  });
});

describe("orderItemSchema", () => {
  it("rejects a non-positive quantity", () => {
    expect(orderItemSchema.safeParse(item({ qty: 0 })).success).toBe(false);
    expect(orderItemSchema.safeParse(item({ qty: -1 })).success).toBe(false);
  });

  it("rejects a fractional unit price (money is integer minor units)", () => {
    expect(orderItemSchema.safeParse(item({ unitPrice: 10.5 })).success).toBe(false);
  });

  it("allows a null menuItemId (source item deleted; snapshot preserves display)", () => {
    expect(orderItemSchema.safeParse(item({ menuItemId: null })).success).toBe(true);
  });

  it("defaults status to placed and modifiers to []", () => {
    const parsed = orderItemSchema.parse({
      id: "i1",
      menuItemId: null,
      name: "Dish",
      unitPrice: 100,
      qty: 1,
    });
    expect(parsed.status).toBe("placed");
    expect(parsed.modifiers).toEqual([]);
  });
});
