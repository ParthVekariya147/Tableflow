import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import {
  DEFAULT_RECEIPT_SECTIONS,
  PAPER_WIDTH_PRESETS,
  buildUpiPaymentUrl,
  formatAmount,
  itemTableHeader,
  itemTableRows,
  labelValueRow,
  isPaymentMethodEnabled,
  isPrintingEnabled,
  mergeReceiptSections,
  paperWidthToMm,
  printerColumns,
  printerDpi,
  printerMarginsMm,
  shouldUseTspl,
  taxRows,
  wrapText,
  type PrinterCommandLanguage,
  type PrinterConnectionType,
  type PrinterSettings,
  type ReceiptSection,
  type ReceiptSectionType,
} from "@amber/domain";
import { ApiError } from "@amber/api-client";
import { api } from "../lib/api";
import { useTenantBrand } from "../context/TenantThemeGate";
import {
  checkAgentHealth,
  detectPrinterInfo,
  printTestReceipt,
} from "../lib/printAgent";
import { api as apiClient } from "../lib/api";
import type { ConnectedAgent } from "@amber/domain";
import { withRetry } from "../lib/retry";
import { Icon } from "../components/Icon";
import { Toggle } from "../components/Toggle";

function messageOf(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
}

const CONNECTION_TYPES: {
  value: PrinterConnectionType;
  label: string;
  desc: string;
}[] = [
  {
    value: "network",
    label: "Network",
    desc: "Printer's own IP address, port 9100",
  },
  {
    value: "usb",
    label: "USB",
    desc: "Installed as a system printer on this PC",
  },
  {
    value: "bluetooth",
    label: "Bluetooth",
    desc: "Paired at the OS level as a printer/port",
  },
];

const COMMAND_LANGUAGES: {
  value: PrinterCommandLanguage;
  label: string;
  desc: string;
}[] = [
  { value: "auto", label: "Auto", desc: "Detects common TSC printers" },
  {
    value: "escpos",
    label: "Receipt ESC/POS",
    desc: "Standard thermal receipt printers",
  },
  {
    value: "tspl",
    label: "TSC / TSPL",
    desc: "TSC label printers such as DA310",
  },
];

const SECTION_META: Record<
  ReceiptSectionType,
  { label: string; icon: string }
> = {
  logo: { label: "Logo", icon: "image" },
  header: {
    label: "Name, Address, GSTIN & FSSAI",
    icon: "storefront",
  },
  orderInfo: { label: "Table & Check Info", icon: "confirmation_number" },
  customerInfo: { label: "Customer Name & Phone", icon: "person" },
  lineItems: { label: "Order Items", icon: "receipt_long" },
  totals: { label: "Subtotal / Tax / Total", icon: "calculate" },
  paymentMethod: { label: "Payment Method", icon: "payments" },
  upiQr: { label: "UPI Payment QR", icon: "qr_code_2" },
  reviewQr: { label: "Rate Us QR", icon: "star" },
  footer: { label: "Footer Message", icon: "notes" },
};

const DEFAULT_FOOTER_MESSAGE = "Thank you for dining with us!";

const EMPTY: Required<
  Pick<
    PrinterSettings,
    | "agentUrl"
    | "connectionType"
    | "networkPort"
    | "commandLanguage"
    | "paperWidth"
  >
> &
  PrinterSettings = {
  enabled: true,
  agentUrl: "http://localhost:9200",
  agentSecret: "",
  connectionType: "network",
  usbPath: "",
  bluetoothPort: "",
  networkHost: "",
  networkPort: 9100,
  commandLanguage: "auto",
  paperWidth: "80mm",
  footerMessage: DEFAULT_FOOTER_MESSAGE,
  sections: DEFAULT_RECEIPT_SECTIONS.map((s) => ({ ...s })),
};

/** Branding/payment fields the receipt draws on, but doesn't own — read-only
 *  here; edited on their own settings pages (Branding / Payments / Profile). */
interface ReceiptContext {
  tenantName: string;
  address?: string;
  phone?: string;
  gstNumber?: string;
  fssaiNumber?: string;
  logoUrl?: string;
  upiId?: string;
  /** Whether UPI is still an accepted tender (Settings → Payments). A tenant
   *  who switched UPI off keeps their VPA on file but gets no scan-to-pay QR. */
  upiEnabled: boolean;
  reviewLink?: string;
  taxRate: number;
}

/** One deliberately long item name so the preview demonstrates how the real
 *  print wraps it — price fixed in the right column, name continued below. */
const SAMPLE_ITEMS = [
  {
    name: "Truffle Parmesan Loaded Fries with Garlic Aioli",
    qty: 2,
    unitPrice: 900,
    modifiers: ["Extra Cheese"],
  },
  { name: "Iced Latte", qty: 1, unitPrice: 450, modifiers: [] },
];

/**
 * Printer settings (`/settings/printer`) — agent URL + security key + printer
 * connection details, plus a Receipt Layout designer (toggle/drag-reorder
 * sections, incl. logo + UPI/review QR codes) with a live preview. Mirrors
 * PaymentsPage.tsx's shape: load `api.tenant.current()`, edit locally, save
 * via `api.tenant.update({ printer })`. See PRINT_RECEIPT_PLAN.md §6.2.
 */
export function PrinterPage() {
  const navigate = useNavigate();
  const { applyTenant } = useTenantBrand();
  const committedRef = useRef<PrinterSettings>(EMPTY);

  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  /** Free-typed custom paper width; committed to `form` only once it's a
   *  plausible roll width, so half-typed values never hit the save payload. */
  const [customWidthDraft, setCustomWidthDraft] = useState("");
  const [context, setContext] = useState<ReceiptContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const [testingAgent, setTestingAgent] = useState(false);
  const [agentStatus, setAgentStatus] = useState<"idle" | "ok" | "fail">(
    "idle",
  );
  const [testingPrint, setTestingPrint] = useState(false);
  const [printStatus, setPrintStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  /** Agents dialled in over the relay — the path phones and installed PWAs
   *  use, where a direct LAN call is impossible. */
  const [relayAgents, setRelayAgents] = useState<ConnectedAgent[] | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectStatus, setDetectStatus] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    api.tenant
      .current()
      .then((t) => {
        if (!active) return;
        const seeded: typeof EMPTY = {
          ...EMPTY,
          ...t.printer,
          // Merge (not just fall back) so layouts saved before a section
          // type existed still get the new section, e.g. customerInfo.
          sections: mergeReceiptSections(t.printer.sections),
        };
        committedRef.current = seeded;
        setForm(seeded);
        setContext({
          tenantName: t.name,
          address: t.address,
          phone: t.phone,
          gstNumber: t.gstNumber,
          fssaiNumber: t.fssaiNumber,
          logoUrl: t.theme.logoUrl,
          upiId: t.upiId,
          upiEnabled: isPaymentMethodEnabled(t.paymentMethods, "upi"),
          reviewLink: t.theme.reviewLink,
          taxRate: t.taxRate,
        });
      })
      .catch((e) => active && setError(messageOf(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  // Poll the relay roster while this page is open so plugging in a till shows
  // up without a manual refresh.
  useEffect(() => {
    let active = true;
    const load = () =>
      apiClient.print
        .agents()
        .then((a) => active && setRelayAgents(a))
        .catch(() => active && setRelayAgents([]));
    void load();
    const id = setInterval(load, 10_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  function set<K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const isCustomPaperWidth = !(PAPER_WIDTH_PRESETS as readonly string[]).includes(
    form.paperWidth,
  );
  const customWidthValue =
    customWidthDraft ||
    (isCustomPaperWidth ? String(Number.parseInt(form.paperWidth, 10) || "") : "");

  function setCustomWidth(raw: string) {
    setCustomWidthDraft(raw);
    const mm = Number.parseInt(raw, 10);
    if (mm >= 40 && mm <= 210) set("paperWidth", `${mm}mm`);
  }

  function generateSecret() {
    set("agentSecret", crypto.randomUUID().replace(/-/g, ""));
    setShowSecret(true);
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(committedRef.current);
  /** The master switch — drives this page AND every print surface elsewhere. */
  const printingOn = isPrintingEnabled(form);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await withRetry(() => api.tenant.update({ printer: form }));
      const seeded: typeof EMPTY = {
        ...EMPTY,
        ...updated.printer,
        sections: mergeReceiptSections(updated.printer.sections),
      };
      committedRef.current = seeded;
      setForm(seeded);
      setSavedTick((t) => t + 1);
      // Push the saved tenant app-wide (same channel BrandingPage uses) so
      // flipping the master switch hides/shows the checkout's print button
      // and the Settings card immediately, with no reload.
      applyTenant(updated);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setSaving(false);
    }
  }

  async function testAgent() {
    setTestingAgent(true);
    setAgentStatus("idle");
    const ok = await checkAgentHealth(form.agentUrl);
    setAgentStatus(ok ? "ok" : "fail");
    setTestingAgent(false);
  }

  /**
   * Ask the print agent what the OS driver says is loaded (paper size + head
   * dpi) and apply it to the form — the driver already knows the stock, so
   * staff don't have to know their roll's millimetres. Applied but not saved:
   * the normal Save button commits it.
   */
  async function detectPaper() {
    setDetecting(true);
    setDetectStatus(null);
    const result = await detectPrinterInfo(form);
    if (result.ok) {
      const { paperWidthMm, dpi, printer } = result.info;
      // Snap to a standard roll when the driver's stock is within 2mm of one
      // (e.g. a "4.00 inch" stock is 101.6mm → the 101mm preset).
      const nearest = (PAPER_WIDTH_PRESETS as readonly string[])
        .map((w) => Number.parseInt(w, 10))
        .find((p) => Math.abs(p - paperWidthMm) <= 2);
      const mm = Math.min(210, Math.max(40, nearest ?? Math.round(paperWidthMm)));
      setForm((f) => ({
        ...f,
        paperWidth: `${mm}mm`,
        ...(dpi ? { dpi: (dpi >= 250 ? 300 : 203) as 203 | 300 } : {}),
      }));
      setCustomWidthDraft("");
      setDetectStatus({
        ok: true,
        message: `${printer}: ${paperWidthMm}mm paper${
          dpi ? ` · ${dpi} dpi` : ""
        } — applied. Save to keep it.`,
      });
    } else {
      setDetectStatus({ ok: false, message: result.message });
    }
    setDetecting(false);
  }

  async function testPrint() {
    setTestingPrint(true);
    setPrintStatus(null);
    const result = await printTestReceipt(form);
    setPrintStatus(
      result.ok
        ? { ok: true, message: "Test receipt sent." }
        : { ok: false, message: result.message },
    );
    setTestingPrint(false);
  }

  return (
    <div className="space-y-lg">
      <header className="flex items-center gap-sm">
        <button
          onClick={() => navigate("/settings")}
          className="rounded-full p-sm text-on-surface-variant transition-colors hover:bg-surface-container-low"
          aria-label="Back to settings"
        >
          <Icon name="arrow_back" />
        </button>
        <div>
          <h1 className="font-headline-md text-headline-md text-on-surface">
            Printer
          </h1>
          <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
            Connect a thermal receipt printer and design what it prints.
          </p>
        </div>
      </header>

      {error && (
        <p className="rounded-lg bg-error-container px-md py-sm font-body-md text-body-md text-on-error-container">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-xxl">
          <Icon
            name="progress_activity"
            size={32}
            className="ag-spin text-on-surface-variant"
          />
        </div>
      ) : (
        <div
          className={`grid grid-cols-1 gap-lg ${
            printingOn ? "lg:grid-cols-[1fr_340px]" : ""
          }`}
        >
          <div className="space-y-lg">
            {/* Master switch — the whole module hangs off this. Everything
                below (and every print button elsewhere in the app) is hidden
                while it's off, for restaurants that bill without a printer. */}
            <section className="rounded-card border border-outline-variant bg-surface-container-lowest p-lg">
              <div className="flex items-start justify-between gap-md">
                <div>
                  <h3 className="font-title-lg text-title-lg text-on-surface">
                    Receipt Printing
                  </h3>
                  <p className="mt-xs font-body-md text-body-md text-on-surface-variant">
                    {printingOn
                      ? "On — staff can print receipts at checkout."
                      : "Off — printing is hidden everywhere for this restaurant. Turn it on if you bill with a thermal printer."}
                  </p>
                </div>
                <Toggle
                  checked={printingOn}
                  onChange={(next) => set("enabled", next)}
                />
              </div>
            </section>

            {!printingOn ? null : (
              <>
            {/* Agent connection */}
            <Section title="Print Agent">
              <p className="mb-md font-body-md text-body-md text-on-surface-variant">
                The address of the local print agent — the same PC as this
                browser (
                <span className="font-data-mono">http://localhost:9200</span>),
                or a different device on your network if the printer lives
                elsewhere.
              </p>
              <div className="flex gap-sm">
                <input
                  value={form.agentUrl}
                  onChange={(e) => set("agentUrl", e.target.value)}
                  placeholder="http://localhost:9200"
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-data-mono text-[13px] text-on-surface focus:border-primary focus:outline-none"
                />
                <button
                  onClick={testAgent}
                  disabled={testingAgent || !form.agentUrl}
                  className="flex shrink-0 items-center gap-xs rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface transition-colors hover:border-primary disabled:opacity-50"
                >
                  {testingAgent ? (
                    <Icon
                      name="progress_activity"
                      size={16}
                      className="ag-spin"
                    />
                  ) : (
                    <Icon name="wifi_find" size={16} />
                  )}
                  Test Connection
                </button>
              </div>
              {agentStatus === "ok" && (
                <p className="mt-sm flex items-center gap-xs font-body-md text-body-md text-[#2e7d32]">
                  <Icon name="check_circle" size={16} fill /> Agent is
                  reachable.
                </p>
              )}
              {agentStatus === "fail" && (
                <p className="mt-sm flex items-center gap-xs font-body-md text-body-md text-error">
                  <Icon name="error" size={16} fill /> Can't reach the agent at
                  that address.
                </p>
              )}
            </Section>

            {/* Security key */}
            <Section title="Security Key">
              <p className="mb-md font-body-md text-body-md text-on-surface-variant">
                Sent with every print request to prove it came from this
                restaurant. Required whenever the agent runs on a different
                device than the printer's browser — set the same value in the
                agent's <span className="font-data-mono">AGENT_SECRET</span>{" "}
                environment variable.
              </p>
              <div className="flex gap-sm">
                <div className="relative w-full">
                  <input
                    value={form.agentSecret}
                    onChange={(e) => set("agentSecret", e.target.value)}
                    type={showSecret ? "text" : "password"}
                    placeholder="No security key set"
                    className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-sm pl-md pr-10 font-data-mono text-[13px] text-on-surface focus:border-primary focus:outline-none"
                  />
                  <button
                    onClick={() => setShowSecret((s) => !s)}
                    className="absolute right-sm top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
                    aria-label={
                      showSecret ? "Hide security key" : "Show security key"
                    }
                    type="button"
                  >
                    <Icon
                      name={showSecret ? "visibility_off" : "visibility"}
                      size={18}
                    />
                  </button>
                </div>
                <button
                  onClick={generateSecret}
                  className="flex shrink-0 items-center gap-xs rounded-lg border border-outline-variant px-md py-sm font-label-md text-label-md text-on-surface transition-colors hover:border-primary"
                  type="button"
                >
                  <Icon name="autorenew" size={16} /> Generate
                </button>
              </div>
              {!(form.agentSecret ?? "").trim() && (
                <p className="mt-sm flex items-center gap-xs font-body-md text-body-md text-[#f57f17]">
                  <Icon name="warning" size={16} fill /> No security key set —
                  only safe if the printer is on this same PC.
                </p>
              )}
            </Section>

            {/* Connection type */}
            <Section title="Printer Connection">
              <div className="mb-md grid grid-cols-3 gap-sm">
                {CONNECTION_TYPES.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => set("connectionType", c.value)}
                    className={`flex flex-col items-start gap-xs rounded-lg border px-md py-sm text-left transition-colors ${
                      form.connectionType === c.value
                        ? "border-primary bg-primary-container/15"
                        : "border-outline-variant hover:border-primary/60"
                    }`}
                  >
                    <span className="font-label-md text-label-md font-semibold text-on-surface">
                      {c.label}
                    </span>
                    <span className="font-body-md text-[11px] text-on-surface-variant">
                      {c.desc}
                    </span>
                  </button>
                ))}
              </div>

              {form.connectionType === "network" && (
                <div className="flex gap-sm">
                  <input
                    value={form.networkHost}
                    onChange={(e) => set("networkHost", e.target.value)}
                    placeholder="192.168.1.50"
                    className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-data-mono text-[13px] text-on-surface focus:border-primary focus:outline-none"
                  />
                  <input
                    value={form.networkPort}
                    onChange={(e) =>
                      set("networkPort", Number(e.target.value) || 9100)
                    }
                    type="number"
                    placeholder="9100"
                    className="w-28 shrink-0 rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-data-mono text-[13px] text-on-surface focus:border-primary focus:outline-none"
                  />
                </div>
              )}
              {form.connectionType === "usb" && (
                <input
                  value={form.usbPath}
                  onChange={(e) => set("usbPath", e.target.value)}
                  placeholder="e.g. TSC DA310 or POS-80"
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-data-mono text-[13px] text-on-surface focus:border-primary focus:outline-none"
                />
              )}
              {form.connectionType === "bluetooth" && (
                <input
                  value={form.bluetoothPort}
                  onChange={(e) => set("bluetoothPort", e.target.value)}
                  placeholder="e.g. COM5 (the paired port/printer name)"
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-data-mono text-[13px] text-on-surface focus:border-primary focus:outline-none"
                />
              )}

              <div className="mt-md flex flex-wrap items-center gap-sm">
                <span className="font-label-md text-label-md text-on-surface-variant">
                  Paper width
                </span>
                {PAPER_WIDTH_PRESETS.map((w) => (
                  <button
                    key={w}
                    onClick={() => {
                      set("paperWidth", w);
                      setCustomWidthDraft("");
                    }}
                    className={`rounded-full border px-md py-1 font-label-md text-label-md transition-colors ${
                      form.paperWidth === w
                        ? "border-primary bg-primary-container/15 text-primary"
                        : "border-outline-variant text-on-surface-variant hover:border-primary/60"
                    }`}
                  >
                    {w}
                  </button>
                ))}
                <label
                  className={`flex items-center gap-xs rounded-full border px-md py-1 font-label-md text-label-md transition-colors ${
                    isCustomPaperWidth
                      ? "border-primary bg-primary-container/15 text-primary"
                      : "border-outline-variant text-on-surface-variant hover:border-primary/60"
                  }`}
                >
                  Custom
                  <input
                    type="number"
                    min={40}
                    max={210}
                    value={customWidthValue}
                    onChange={(e) => setCustomWidth(e.target.value)}
                    placeholder="101"
                    className="w-[56px] bg-transparent text-right font-data-mono text-[13px] focus:outline-none"
                  />
                  mm
                </label>
                <button
                  onClick={() => void detectPaper()}
                  disabled={detecting}
                  type="button"
                  className="flex items-center gap-xs rounded-full border border-outline-variant px-md py-1 font-label-md text-label-md text-on-surface transition-colors hover:border-primary disabled:opacity-50"
                >
                  {detecting ? (
                    <Icon name="progress_activity" size={16} className="ag-spin" />
                  ) : (
                    <Icon name="frame_inspect" size={16} />
                  )}
                  Detect from printer
                </button>
              </div>
              {detectStatus && (
                <p
                  className={`mt-sm flex items-center gap-xs font-body-md text-body-md ${
                    detectStatus.ok ? "text-[#2e7d32]" : "text-error"
                  }`}
                >
                  <Icon
                    name={detectStatus.ok ? "check_circle" : "error"}
                    size={16}
                    fill
                  />
                  {detectStatus.message}
                </p>
              )}

              <div className="mt-md flex flex-wrap items-center gap-sm">
                <span className="font-label-md text-label-md text-on-surface-variant">
                  Print head
                </span>
                {([203, 300] as const).map((dpi) => (
                  <button
                    key={dpi}
                    onClick={() => set("dpi", dpi)}
                    className={`rounded-full border px-md py-1 font-label-md text-label-md transition-colors ${
                      printerDpi(form) === dpi
                        ? "border-primary bg-primary-container/15 text-primary"
                        : "border-outline-variant text-on-surface-variant hover:border-primary/60"
                    }`}
                  >
                    {dpi} dpi
                  </button>
                ))}
                <span className="font-body-md text-[11px] text-on-surface-variant">
                  TSC DA310 / DA320 are 300 dpi — the wrong value prints in only
                  part of the paper width.
                </span>
              </div>

              <div className="mt-md flex flex-wrap items-center gap-sm">
                <span className="font-label-md text-label-md text-on-surface-variant">
                  Side margins
                </span>
                {(
                  [
                    ["marginLeftMm", "Left"],
                    ["marginRightMm", "Right"],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-xs rounded-full border border-outline-variant px-md py-1 font-label-md text-label-md text-on-surface-variant"
                  >
                    {label}
                    <input
                      type="number"
                      min={0}
                      max={20}
                      step={0.5}
                      value={form[key] ?? printerMarginsMm(form)[key === "marginLeftMm" ? "left" : "right"]}
                      onChange={(e) => {
                        const mm = Number(e.target.value);
                        if (Number.isFinite(mm) && mm >= 0 && mm <= 20)
                          set(key, mm);
                      }}
                      className="w-[48px] bg-transparent text-right font-data-mono text-[13px] focus:outline-none"
                    />
                    mm
                  </label>
                ))}
                <span className="font-body-md text-[11px] text-on-surface-variant">
                  Blank space kept at each paper edge (TSC/label printing).
                </span>
              </div>

              <div className="mt-md">
                <span className="mb-xs block font-label-md text-label-md text-on-surface-variant">
                  Printer language
                </span>
                <div className="grid grid-cols-1 gap-sm md:grid-cols-3">
                  {COMMAND_LANGUAGES.map((language) => (
                    <button
                      key={language.value}
                      onClick={() => set("commandLanguage", language.value)}
                      type="button"
                      className={`flex flex-col items-start gap-xs rounded-lg border px-md py-sm text-left transition-colors ${
                        (form.commandLanguage ?? "auto") === language.value
                          ? "border-primary bg-primary-container/15"
                          : "border-outline-variant hover:border-primary/60"
                      }`}
                    >
                      <span className="font-label-md text-label-md font-semibold text-on-surface">
                        {language.label}
                      </span>
                      <span className="font-body-md text-[11px] text-on-surface-variant">
                        {language.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </Section>

            {/* Relay status — printing from phones/tablets */}
            <Section title="Printing From Phones & Tablets">
              <p className="mb-md font-body-md text-body-md text-on-surface-variant">
                A phone or installed app can't reach a printer on your local
                network directly. Instead the print agent connects out to
                Amber and stays connected, so staff can print from any device,
                anywhere — the same way the till does.
              </p>
              {relayAgents === null ? (
                <p className="flex items-center gap-xs font-body-md text-body-md text-on-surface-variant">
                  <Icon name="progress_activity" size={16} className="ag-spin" />
                  Checking…
                </p>
              ) : relayAgents.length === 0 ? (
                <div className="rounded-lg border border-outline-variant bg-surface-container-low p-md">
                  <p className="flex items-center gap-xs font-body-md text-body-md text-on-surface">
                    <Icon name="cloud_off" size={18} /> No print agent connected
                  </p>
                  <p className="mt-xs font-body-md text-[12px] text-on-surface-variant">
                    Set a security key above, then start the agent on the till
                    with <span className="font-data-mono">AMBER_API_URL</span>,{" "}
                    <span className="font-data-mono">AMBER_TENANT_SLUG</span> and{" "}
                    <span className="font-data-mono">AGENT_SECRET</span>. Printing
                    from this computer still works without it.
                  </p>
                </div>
              ) : (
                <ul className="space-y-sm">
                  {relayAgents.map((agent) => (
                    <li
                      key={agent.agentId}
                      className="rounded-lg border border-primary/30 bg-primary-container/10 p-md"
                    >
                      <p className="flex items-center gap-xs font-label-md text-label-md font-semibold text-on-surface">
                        <span className="h-2 w-2 rounded-full bg-[#2e7d32]" />
                        {agent.agentName}
                        <span className="font-body-md text-[11px] font-normal text-on-surface-variant">
                          v{agent.version}
                          {agent.platform ? ` · ${agent.platform}` : ""}
                        </span>
                      </p>
                      <p className="mt-xs font-body-md text-[12px] text-on-surface-variant">
                        {agent.printers.length > 0
                          ? `${agent.printers.length} printer${agent.printers.length === 1 ? "" : "s"}: ${agent.printers
                              .map((p) => p.label)
                              .join(", ")}`
                          : "No printers reported"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {/* Receipt layout designer */}
            <Section title="Receipt Layout">
              <p className="mb-md font-body-md text-body-md text-on-surface-variant">
                Drag to reorder, toggle to show or hide. Name, logo, GST number,
                UPI ID and review link are edited on their own settings pages
                (Restaurant Profile / Branding / Payments) — this controls
                whether and where they appear on the printed receipt.
              </p>
              <ReceiptSectionsEditor
                sections={form.sections ?? []}
                onChange={(next) => set("sections", next)}
                context={context}
              />
              <div className="mt-md">
                <label className="mb-xs block font-label-md text-label-md text-on-surface">
                  Footer message
                </label>
                <input
                  value={form.footerMessage ?? ""}
                  onChange={(e) => set("footerMessage", e.target.value)}
                  disabled={
                    !form.sections?.find((s) => s.type === "footer")?.enabled
                  }
                  placeholder={DEFAULT_FOOTER_MESSAGE}
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none disabled:opacity-50"
                />
              </div>
            </Section>

            {/* Test print */}
            <Section title="Test Print">
              <p className="mb-md font-body-md text-body-md text-on-surface-variant">
                Verify the exact connection above before relying on it at
                checkout. (Prints a short fixed test slip, not the layout
                below.)
              </p>
              <button
                onClick={testPrint}
                disabled={testingPrint}
                className="flex items-center gap-xs rounded-full border border-outline-variant px-lg py-sm font-label-md text-label-md text-on-surface transition-colors hover:border-primary disabled:opacity-60"
              >
                {testingPrint ? (
                  <Icon
                    name="progress_activity"
                    size={16}
                    className="ag-spin"
                  />
                ) : (
                  <Icon name="receipt" size={16} />
                )}
                Print Test Receipt
              </button>
              {printStatus && (
                <p
                  className={`mt-sm flex items-center gap-xs font-body-md text-body-md ${
                    printStatus.ok ? "text-[#2e7d32]" : "text-error"
                  }`}
                >
                  <Icon
                    name={printStatus.ok ? "check_circle" : "error"}
                    size={16}
                    fill
                  />
                  {printStatus.message}
                </p>
              )}
            </Section>
              </>
            )}

            {/* Actions */}
            <div className="flex items-center gap-sm">
              <button
                onClick={save}
                disabled={saving || !dirty}
                className="flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary transition-colors hover:bg-primary-container disabled:opacity-60"
              >
                {saving && (
                  <Icon
                    name="progress_activity"
                    size={16}
                    className="ag-spin"
                  />
                )}
                {saving ? "Saving…" : "Save changes"}
              </button>
              {!dirty && savedTick > 0 && (
                <span className="flex items-center gap-xs font-label-md text-label-md text-on-surface-variant">
                  <Icon name="check_circle" size={16} /> Saved
                </span>
              )}
            </div>
          </div>

          {/* Live preview */}
          {printingOn && (
            <aside className="lg:sticky lg:top-lg lg:self-start">
              <ReceiptPreview
                sections={form.sections ?? []}
                footerMessage={
                  form.footerMessage?.trim() || DEFAULT_FOOTER_MESSAGE
                }
                context={context}
                settings={form}
              />
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-outline-variant bg-surface-container-lowest p-lg">
      <h3 className="mb-md font-title-lg text-title-lg text-on-surface">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Draggable (native HTML5 DnD), toggle-able list of receipt sections — order
 *  in this array is print order. No drag-and-drop library: nine rows doesn't
 *  justify the extra dependency. */
function ReceiptSectionsEditor({
  sections,
  onChange,
  context,
}: {
  sections: ReceiptSection[];
  onChange: (next: ReceiptSection[]) => void;
  context: ReceiptContext | null;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function move(from: number, to: number) {
    if (from === to) return;
    const next = [...sections];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    onChange(next);
  }

  function missingDataHint(type: ReceiptSectionType): string | null {
    if (type === "upiQr") {
      if (!context?.upiId) return "Set a UPI ID in Settings → Payments";
      if (!context.upiEnabled)
        return "UPI is switched off in Settings → Payments";
      return "Prints on unpaid bills only — use Print Bill at checkout";
    }
    if (type === "reviewQr" && !context?.reviewLink)
      return "Set a review link in Settings → Branding";
    if (type === "logo" && !context?.logoUrl)
      return "Upload a logo in Settings → Branding";
    return null;
  }

  return (
    <ul className="space-y-xs">
      {sections.map((section, index) => {
        const meta = SECTION_META[section.type];
        const hint = section.enabled ? missingDataHint(section.type) : null;
        return (
          <li
            key={section.type}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null) move(dragIndex, index);
              setDragIndex(null);
            }}
            onDragEnd={() => setDragIndex(null)}
            className={`flex items-center gap-sm rounded-lg border border-outline-variant bg-surface px-sm py-sm transition-opacity ${
              dragIndex === index ? "opacity-40" : ""
            } ${!section.enabled ? "opacity-60" : ""}`}
          >
            <span className="cursor-grab text-on-surface-variant" aria-hidden>
              <Icon name="drag_indicator" size={18} />
            </span>
            <Icon
              name={meta.icon}
              size={18}
              className="shrink-0 text-on-surface-variant"
            />
            <span className="flex-1 min-w-0">
              <span className="block font-label-md text-label-md text-on-surface">
                {meta.label}
              </span>
              {hint && (
                <span className="block font-body-md text-[11px] text-on-surface-variant">
                  {hint}
                </span>
              )}
            </span>
            <Toggle
              checked={section.enabled}
              onChange={(next) => {
                const copy = [...sections];
                copy[index] = { ...section, enabled: next };
                onChange(copy);
              }}
            />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The paper strip's font: a REAL monospace stack, deliberately NOT the
 * `font-data-mono` token — that aliases to the brand sans, and proportional
 * glyphs make column alignment impossible. The physical printer has a fixed-
 * width font, so the preview must too.
 */
const PAPER_FONT =
  'ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace';

/** One printed line of the preview, on the exact character grid. */
function PaperLine({
  text,
  center,
  bold,
}: {
  text: string;
  center?: boolean;
  bold?: boolean;
}) {
  return (
    <pre
      className={`m-0 whitespace-pre ${center ? "text-center" : ""} ${
        bold ? "font-bold" : ""
      }`}
    >
      {text || " "}
    </pre>
  );
}

/**
 * Character-accurate paper strip: built with the SAME layout functions
 * (`printerColumns` / `itemRows` / `labelValueRow` / `formatAmount`) the
 * print agent runs, at the configured paper width and command language — so
 * what you see here is, character for character, what comes off the printer.
 * Logo/QR stay graphical (they print as graphics too); the strip resizes as
 * the paper-width setting changes.
 */
function ReceiptPreview({
  sections,
  footerMessage,
  context,
  settings,
}: {
  sections: ReceiptSection[];
  footerMessage: string;
  context: ReceiptContext | null;
  settings: PrinterSettings;
}) {
  const columns = printerColumns(settings);
  const tspl = shouldUseTspl(settings);
  const mm = paperWidthToMm(settings.paperWidth);
  const separator = "-".repeat(columns);

  const subtotal = SAMPLE_ITEMS.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const taxRate = context?.taxRate ?? 0;
  const tax = Math.round(subtotal * taxRate);
  const total = subtotal + tax;
  const tendered = total + 30;
  // Mirrors lib/receipt.ts's gate exactly: a VPA on file is not enough, UPI
  // must still be an accepted tender.
  const upiUrl =
    context?.upiId &&
    context.upiEnabled &&
    buildUpiPaymentUrl({
      upiId: context.upiId,
      payeeName: context.tenantName,
      amountCents: total,
      note: "Sample bill",
    });

  return (
    <div className="rounded-card border border-outline-variant bg-surface-container-lowest p-lg">
      <p className="mb-xs font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
        Live Preview
      </p>
      <p className="mb-md font-body-md text-[11px] text-on-surface-variant">
        {mm}mm paper · {columns} characters per line ·{" "}
        {tspl ? `TSPL · ${printerDpi(settings)} dpi` : "ESC/POS"}
      </p>
      <div className="overflow-x-auto">
        <div
          className="mx-auto w-fit rounded-sm bg-white px-md py-lg text-[11px] leading-snug text-black shadow-inner"
          style={{ fontFamily: PAPER_FONT }}
        >
          <div style={{ width: `${columns}ch` }}>
            {sections.map((section) => {
              if (!section.enabled) return null;
              switch (section.type) {
                case "logo":
                  return context?.logoUrl ? (
                    <img
                      key="logo"
                      src={context.logoUrl}
                      alt=""
                      className="mx-auto mb-sm h-10 object-contain"
                    />
                  ) : (
                    <div
                      key="logo"
                      className="mx-auto mb-sm flex h-10 w-24 items-center justify-center rounded border border-dashed border-black/30 text-[9px] text-black/40"
                    >
                      no logo
                    </div>
                  );
                case "header":
                  return (
                    <div key="header" className="mb-sm">
                      <PaperLine
                        text={context?.tenantName ?? "Restaurant Name"}
                        center
                        bold={!tspl}
                      />
                      {context?.address &&
                        wrapText(context.address, columns).map((line, i) => (
                          <PaperLine key={i} text={line} center />
                        ))}
                      {context?.phone && (
                        <PaperLine text={`Ph: ${context.phone}`} center />
                      )}
                      {context?.gstNumber && (
                        <PaperLine text={`GSTIN: ${context.gstNumber}`} center />
                      )}
                      {context?.fssaiNumber && (
                        <PaperLine text={`FSSAI: ${context.fssaiNumber}`} center />
                      )}
                    </div>
                  );
                case "orderInfo":
                  return (
                    <div key="orderInfo" className="mb-sm">
                      <PaperLine text="Table 4 - Check #1042" center />
                      <PaperLine text={new Date().toLocaleString()} center />
                      <PaperLine text={separator} />
                    </div>
                  );
                case "customerInfo":
                  return (
                    <div key="customerInfo" className="mb-sm">
                      <PaperLine text="Name: Ramesh Kumar" />
                      <PaperLine text="Ph: 98765 43210" />
                      <PaperLine text={separator} />
                    </div>
                  );
                case "lineItems":
                  return (
                    <div key="lineItems" className="mb-sm">
                      <PaperLine text={itemTableHeader(columns)} />
                      <PaperLine text={separator} />
                      {SAMPLE_ITEMS.map((item) => (
                        <div key={item.name}>
                          {itemTableRows(item, columns).map((row, i) => (
                            <PaperLine key={i} text={row} />
                          ))}
                          {item.modifiers.map((m) => (
                            <PaperLine key={m} text={`  ${m}`} />
                          ))}
                        </div>
                      ))}
                      <PaperLine text={separator} />
                    </div>
                  );
                case "totals":
                  return (
                    <div key="totals" className="mb-sm">
                      <PaperLine
                        text={labelValueRow(
                          "Total Qty",
                          String(
                            SAMPLE_ITEMS.reduce((s, i) => s + i.qty, 0),
                          ),
                          columns,
                        )}
                      />
                      <PaperLine
                        text={labelValueRow(
                          "Subtotal",
                          formatAmount(subtotal),
                          columns,
                        )}
                      />
                      {taxRows(taxRate, tax, !!context?.gstNumber).map(
                        ([label, value]) => (
                          <PaperLine
                            key={label}
                            text={labelValueRow(label, value, columns)}
                          />
                        ),
                      )}
                      <PaperLine
                        text={labelValueRow(
                          "TOTAL",
                          formatAmount(total),
                          columns,
                        )}
                        bold={!tspl}
                      />
                    </div>
                  );
                case "paymentMethod":
                  return (
                    <div key="paymentMethod" className="mb-sm">
                      <PaperLine text="Paid via CASH" />
                      <PaperLine
                        text={labelValueRow(
                          "Tendered",
                          formatAmount(tendered),
                          columns,
                        )}
                      />
                      <PaperLine
                        text={labelValueRow(
                          "Change",
                          formatAmount(tendered - total),
                          columns,
                        )}
                      />
                    </div>
                  );
                case "upiQr":
                  return (
                    <div
                      key="upiQr"
                      className="mb-sm flex flex-col items-center gap-1"
                    >
                      {upiUrl ? (
                        <QRCodeCanvas value={upiUrl} size={64} level="M" />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center border border-dashed border-black/30 px-1 text-center text-[8px] text-black/40">
                          {context?.upiId ? "UPI tender off" : "no UPI ID"}
                        </div>
                      )}
                      <PaperLine text="Scan to pay via UPI" center />
                      {/* The one section whose print depends on WHEN it's
                          printed, not just the toggle — say so, or this
                          preview reads as a promise the paid receipt breaks. */}
                      <span className="text-center text-[8px] italic leading-tight text-black/40">
                        unpaid bills only
                      </span>
                    </div>
                  );
                case "reviewQr":
                  return (
                    <div
                      key="reviewQr"
                      className="mb-sm flex flex-col items-center gap-1"
                    >
                      {context?.reviewLink ? (
                        <QRCodeCanvas
                          value={context.reviewLink}
                          size={64}
                          level="M"
                        />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center border border-dashed border-black/30 text-center text-[8px] text-black/40">
                          no review link
                        </div>
                      )}
                      <PaperLine text="Scan to rate your experience" center />
                    </div>
                  );
                case "footer":
                  return (
                    <div key="footer">
                      {wrapText(footerMessage, columns).map((row, i) => (
                        <PaperLine key={i} text={row} center />
                      ))}
                    </div>
                  );
                default:
                  return null;
              }
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
