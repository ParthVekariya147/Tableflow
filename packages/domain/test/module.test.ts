import { describe, expect, it } from "vitest";
import {
  TENANT_MODULES,
  TENANT_MODULE_META,
  isLoyaltyEnabled,
  isModuleEnabled,
  type TenantModuleConfig,
} from "../src/module";
import { isPrintingEnabled } from "../src/printer";

const program = {
  enabled: true,
  earnRatePerCurrency: 1,
  redemptionRate: 100,
  minRedeemPoints: 100,
  maxRedeemPercent: 0.5,
};

const loyaltyOn: TenantModuleConfig = { loyalty: program };
const loyaltyOff: TenantModuleConfig = { loyalty: { ...program, enabled: false } };

describe("isLoyaltyEnabled", () => {
  it("is on only when explicitly enabled", () => {
    expect(isLoyaltyEnabled(program)).toBe(true);
    expect(isLoyaltyEnabled({ ...program, enabled: false })).toBe(false);
  });

  it("treats an unset program as OFF — loyalty is opt-in", () => {
    // The opposite of printing (below). A tenant who never opened the settings
    // page never agreed to accrue points against their guests' phone numbers.
    expect(isLoyaltyEnabled(undefined)).toBe(false);
  });
});

describe("the printing / loyalty default asymmetry", () => {
  // The single most breakable thing about the registry: the two modules
  // deliberately disagree about what an unset config means, which is exactly
  // why every caller must go through isModuleEnabled rather than `?.enabled`.
  it("defaults printing ON and loyalty OFF for an unconfigured tenant", () => {
    expect(isModuleEnabled({}, "printing")).toBe(true);
    expect(isModuleEnabled({}, "loyalty")).toBe(false);
  });

  it("keeps each module's meta in step with its resolver", () => {
    for (const key of TENANT_MODULES) {
      expect(isModuleEnabled({}, key)).toBe(TENANT_MODULE_META[key].defaultEnabled);
    }
  });

  it("agrees with the underlying per-module helpers", () => {
    expect(isModuleEnabled(loyaltyOn, "loyalty")).toBe(isLoyaltyEnabled(program));
    expect(isModuleEnabled({ printer: { enabled: false } }, "printing")).toBe(
      isPrintingEnabled({ enabled: false }),
    );
  });
});

describe("isModuleEnabled", () => {
  it("reads an explicit switch in both directions", () => {
    expect(isModuleEnabled(loyaltyOn, "loyalty")).toBe(true);
    expect(isModuleEnabled(loyaltyOff, "loyalty")).toBe(false);
    expect(isModuleEnabled({ printer: { enabled: true } }, "printing")).toBe(true);
    expect(isModuleEnabled({ printer: { enabled: false } }, "printing")).toBe(false);
  });

  it("falls back to the module default when no tenant is loaded yet", () => {
    // Callers that run before the tenant fetch resolves (route guards, the
    // sidebar) pass undefined rather than a half-built tenant.
    expect(isModuleEnabled(undefined, "printing")).toBe(true);
    expect(isModuleEnabled(undefined, "loyalty")).toBe(false);
  });

  it("gates each module independently", () => {
    const printOnlyTenant: TenantModuleConfig = {
      printer: { enabled: true },
      loyalty: { ...program, enabled: false },
    };
    expect(isModuleEnabled(printOnlyTenant, "printing")).toBe(true);
    expect(isModuleEnabled(printOnlyTenant, "loyalty")).toBe(false);
  });
});

describe("module metadata", () => {
  it("gives every module a settings route that owns its switch", () => {
    // That route is the module's only survivor when it is off — without it a
    // tenant could switch a module off and have no way to switch it back on.
    for (const key of TENANT_MODULES) {
      const meta = TENANT_MODULE_META[key];
      expect(meta.key).toBe(key);
      expect(meta.switchRoute.startsWith("/settings/")).toBe(true);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.offDescription.length).toBeGreaterThan(0);
    }
  });
});
