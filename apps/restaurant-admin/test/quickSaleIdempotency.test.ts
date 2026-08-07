import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The Quick Sale idempotency key is what makes "tap Confirm again" safe after a
 * lost response. Its whole value depends on being STABLE across reloads and
 * retries, and on being retired only once a sale is confirmed recorded.
 */

// Minimal localStorage stub — these modules run in a browser, tests run in node.
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
  get size() {
    return this.map.size;
  }
}

const storage = new MemoryStorage();
vi.stubGlobal("localStorage", storage);

// crypto.getRandomValues exists in node's webcrypto; randomId relies on it
// rather than crypto.randomUUID precisely because the admin runs over plain
// http on the LAN, where randomUUID is undefined.
const { getQuickSaleRequestId, clearQuickSaleDraft, saveQuickSaleDraft, loadQuickSaleDraft } =
  await import("../src/lib/quickSaleDraft");
const { randomId } = await import("../src/lib/randomId");

beforeEach(() => {
  storage.clear();
});

describe("quick sale idempotency key", () => {
  it("returns the same key for every retry of one cart", () => {
    const first = getQuickSaleRequestId();
    const second = getQuickSaleRequestId();
    const third = getQuickSaleRequestId();
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("survives a reload (it lives in storage, not memory)", () => {
    const before = getQuickSaleRequestId();
    // A reload loses module state but not localStorage.
    const after = getQuickSaleRequestId();
    expect(after).toBe(before);
    expect(storage.getItem("amber-quick-sale-request:default")).toBe(before);
  });

  it("issues a NEW key only after the sale is confirmed recorded", () => {
    const soldKey = getQuickSaleRequestId();
    clearQuickSaleDraft(); // called only on a confirmed sale
    const nextCustomer = getQuickSaleRequestId();
    expect(nextCustomer).not.toBe(soldKey);
  });

  it("clears the cart and the key together, so a new sale can't reuse a spent key", () => {
    saveQuickSaleDraft([
      { key: "l1", menuItemId: "m1", name: "Tea", basePriceCents: 2000, qty: 1 },
    ]);
    getQuickSaleRequestId();
    expect(loadQuickSaleDraft()).toHaveLength(1);

    clearQuickSaleDraft();
    expect(loadQuickSaleDraft()).toHaveLength(0);
    expect(storage.getItem("amber-quick-sale-request:default")).toBeNull();
  });

  it("still produces a key when storage is unavailable (private mode)", () => {
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("SecurityError");
      },
      removeItem() {
        throw new Error("SecurityError");
      },
    });
    // Charging must never be blocked by storage; retry protection degrades,
    // the sale still goes through.
    expect(() => getQuickSaleRequestId()).not.toThrow();
    expect(getQuickSaleRequestId()).toHaveLength(32);
    vi.stubGlobal("localStorage", storage);
  });
});

describe("randomId (insecure-context safe)", () => {
  it("produces 128 bits of hex without crypto.randomUUID", () => {
    const id = randomId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("does not collide across many draws", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => randomId()));
    expect(seen.size).toBe(2000);
  });

  it("works when crypto.randomUUID is missing entirely (plain http LAN)", () => {
    const real = globalThis.crypto;
    // Simulate the LAN http context: getRandomValues present, randomUUID not.
    vi.stubGlobal("crypto", { getRandomValues: real.getRandomValues.bind(real) });
    expect(() => randomId()).not.toThrow();
    expect(randomId()).toMatch(/^[0-9a-f]{32}$/);
    vi.stubGlobal("crypto", real);
  });
});
