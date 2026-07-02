import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import {
  DEFAULT_RECEIPT_SECTIONS,
  buildUpiPaymentUrl,
  type PrinterConnectionType,
  type PrinterSettings,
  type ReceiptSection,
  type ReceiptSectionType,
} from "@amber/domain";
import { ApiError } from "@amber/api-client";
import { api } from "../lib/api";
import { checkAgentHealth, printTestReceipt } from "../lib/printAgent";
import { Icon } from "../components/Icon";
import { Toggle } from "../components/Toggle";
import { useMoney } from "../store/AdminStore";

function messageOf(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
}

const CONNECTION_TYPES: { value: PrinterConnectionType; label: string; desc: string }[] = [
  { value: "network", label: "Network", desc: "Printer's own IP address, port 9100" },
  { value: "usb", label: "USB", desc: "Installed as a system printer on this PC" },
  { value: "bluetooth", label: "Bluetooth", desc: "Paired at the OS level as a printer/port" },
];

const SECTION_META: Record<ReceiptSectionType, { label: string; icon: string }> = {
  logo: { label: "Logo", icon: "image" },
  header: { label: "Restaurant Name & GST", icon: "storefront" },
  orderInfo: { label: "Table & Check Info", icon: "confirmation_number" },
  lineItems: { label: "Order Items", icon: "receipt_long" },
  totals: { label: "Subtotal / Tax / Total", icon: "calculate" },
  paymentMethod: { label: "Payment Method", icon: "payments" },
  upiQr: { label: "UPI Payment QR", icon: "qr_code_2" },
  reviewQr: { label: "Rate Us QR", icon: "star" },
  footer: { label: "Footer Message", icon: "notes" },
};

const DEFAULT_FOOTER_MESSAGE = "Thank you for dining with us!";

const EMPTY: Required<
  Pick<PrinterSettings, "agentUrl" | "connectionType" | "networkPort" | "paperWidth">
> &
  PrinterSettings = {
  agentUrl: "http://localhost:9200",
  agentSecret: "",
  connectionType: "network",
  usbPath: "",
  bluetoothPort: "",
  networkHost: "",
  networkPort: 9100,
  paperWidth: "80mm",
  footerMessage: DEFAULT_FOOTER_MESSAGE,
  sections: DEFAULT_RECEIPT_SECTIONS.map((s) => ({ ...s })),
};

/** Branding/payment fields the receipt draws on, but doesn't own — read-only
 *  here; edited on their own settings pages (Branding / Payments / Profile). */
interface ReceiptContext {
  tenantName: string;
  gstNumber?: string;
  logoUrl?: string;
  upiId?: string;
  reviewLink?: string;
  taxRate: number;
}

const SAMPLE_ITEMS = [
  { name: "Truffle Fries", qty: 2, unitPrice: 900, modifiers: ["Extra Cheese"] },
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
  const money = useMoney();
  const committedRef = useRef<PrinterSettings>(EMPTY);

  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [context, setContext] = useState<ReceiptContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  const [testingAgent, setTestingAgent] = useState(false);
  const [agentStatus, setAgentStatus] = useState<"idle" | "ok" | "fail">("idle");
  const [testingPrint, setTestingPrint] = useState(false);
  const [printStatus, setPrintStatus] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    api.tenant
      .current()
      .then((t) => {
        if (!active) return;
        const seeded: typeof EMPTY = {
          ...EMPTY,
          ...t.printer,
          sections: t.printer.sections?.length
            ? t.printer.sections
            : DEFAULT_RECEIPT_SECTIONS.map((s) => ({ ...s })),
        };
        committedRef.current = seeded;
        setForm(seeded);
        setContext({
          tenantName: t.name,
          gstNumber: t.gstNumber,
          logoUrl: t.theme.logoUrl,
          upiId: t.upiId,
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

  function set<K extends keyof typeof EMPTY>(key: K, value: (typeof EMPTY)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function generateSecret() {
    set("agentSecret", crypto.randomUUID().replace(/-/g, ""));
    setShowSecret(true);
  }

  const dirty = JSON.stringify(form) !== JSON.stringify(committedRef.current);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.tenant.update({ printer: form });
      const seeded: typeof EMPTY = {
        ...EMPTY,
        ...updated.printer,
        sections: updated.printer.sections?.length
          ? updated.printer.sections
          : DEFAULT_RECEIPT_SECTIONS.map((s) => ({ ...s })),
      };
      committedRef.current = seeded;
      setForm(seeded);
      setSavedTick((t) => t + 1);
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

  async function testPrint() {
    setTestingPrint(true);
    setPrintStatus(null);
    const result = await printTestReceipt(form);
    setPrintStatus(
      result.ok ? { ok: true, message: "Test receipt sent." } : { ok: false, message: result.message },
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
          <h1 className="font-headline-md text-headline-md text-on-surface">Printer</h1>
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
          <Icon name="progress_activity" size={32} className="ag-spin text-on-surface-variant" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-lg lg:grid-cols-[1fr_340px]">
          <div className="space-y-lg">
            {/* Agent connection */}
            <Section title="Print Agent">
              <p className="mb-md font-body-md text-body-md text-on-surface-variant">
                The address of the local print agent — the same PC as this browser
                (<span className="font-data-mono">http://localhost:9200</span>), or a
                different device on your network if the printer lives elsewhere.
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
                    <Icon name="progress_activity" size={16} className="ag-spin" />
                  ) : (
                    <Icon name="wifi_find" size={16} />
                  )}
                  Test Connection
                </button>
              </div>
              {agentStatus === "ok" && (
                <p className="mt-sm flex items-center gap-xs font-body-md text-body-md text-[#2e7d32]">
                  <Icon name="check_circle" size={16} fill /> Agent is reachable.
                </p>
              )}
              {agentStatus === "fail" && (
                <p className="mt-sm flex items-center gap-xs font-body-md text-body-md text-error">
                  <Icon name="error" size={16} fill /> Can't reach the agent at that address.
                </p>
              )}
            </Section>

            {/* Security key */}
            <Section title="Security Key">
              <p className="mb-md font-body-md text-body-md text-on-surface-variant">
                Sent with every print request to prove it came from this restaurant.
                Required whenever the agent runs on a different device than the
                printer's browser — set the same value in the agent's{" "}
                <span className="font-data-mono">AGENT_SECRET</span> environment variable.
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
                    aria-label={showSecret ? "Hide security key" : "Show security key"}
                    type="button"
                  >
                    <Icon name={showSecret ? "visibility_off" : "visibility"} size={18} />
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
                  <Icon name="warning" size={16} fill /> No security key set — only safe if the
                  printer is on this same PC.
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
                    <span className="font-body-md text-[11px] text-on-surface-variant">{c.desc}</span>
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
                    onChange={(e) => set("networkPort", Number(e.target.value) || 9100)}
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
                  placeholder="e.g. POS-80 (the printer's name on this PC)"
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

              <div className="mt-md flex items-center gap-sm">
                <span className="font-label-md text-label-md text-on-surface-variant">
                  Paper width
                </span>
                {(["58mm", "80mm"] as const).map((w) => (
                  <button
                    key={w}
                    onClick={() => set("paperWidth", w)}
                    className={`rounded-full border px-md py-1 font-label-md text-label-md transition-colors ${
                      form.paperWidth === w
                        ? "border-primary bg-primary-container/15 text-primary"
                        : "border-outline-variant text-on-surface-variant hover:border-primary/60"
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </Section>

            {/* Receipt layout designer */}
            <Section title="Receipt Layout">
              <p className="mb-md font-body-md text-body-md text-on-surface-variant">
                Drag to reorder, toggle to show or hide. Name, logo, GST number, UPI
                ID and review link are edited on their own settings pages (Restaurant
                Profile / Branding / Payments) — this controls whether and where they
                appear on the printed receipt.
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
                  disabled={!form.sections?.find((s) => s.type === "footer")?.enabled}
                  placeholder={DEFAULT_FOOTER_MESSAGE}
                  className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-md py-sm font-body-md text-body-md text-on-surface focus:border-primary focus:outline-none disabled:opacity-50"
                />
              </div>
            </Section>

            {/* Test print */}
            <Section title="Test Print">
              <p className="mb-md font-body-md text-body-md text-on-surface-variant">
                Verify the exact connection above before relying on it at checkout.
                (Prints a short fixed test slip, not the layout below.)
              </p>
              <button
                onClick={testPrint}
                disabled={testingPrint}
                className="flex items-center gap-xs rounded-full border border-outline-variant px-lg py-sm font-label-md text-label-md text-on-surface transition-colors hover:border-primary disabled:opacity-60"
              >
                {testingPrint ? (
                  <Icon name="progress_activity" size={16} className="ag-spin" />
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
                  <Icon name={printStatus.ok ? "check_circle" : "error"} size={16} fill />
                  {printStatus.message}
                </p>
              )}
            </Section>

            {/* Actions */}
            <div className="flex items-center gap-sm">
              <button
                onClick={save}
                disabled={saving || !dirty}
                className="flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label-md text-label-md text-on-primary transition-colors hover:bg-primary-container disabled:opacity-60"
              >
                {saving && <Icon name="progress_activity" size={16} className="ag-spin" />}
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
          <aside className="lg:sticky lg:top-lg lg:self-start">
            <ReceiptPreview
              sections={form.sections ?? []}
              footerMessage={form.footerMessage?.trim() || DEFAULT_FOOTER_MESSAGE}
              context={context}
              money={money}
            />
          </aside>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-outline-variant bg-surface-container-lowest p-lg">
      <h3 className="mb-md font-title-lg text-title-lg text-on-surface">{title}</h3>
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
    if (type === "upiQr" && !context?.upiId) return "Set a UPI ID in Settings → Payments";
    if (type === "reviewQr" && !context?.reviewLink) return "Set a review link in Settings → Branding";
    if (type === "logo" && !context?.logoUrl) return "Upload a logo in Settings → Branding";
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
            <Icon name={meta.icon} size={18} className="shrink-0 text-on-surface-variant" />
            <span className="flex-1 min-w-0">
              <span className="block font-label-md text-label-md text-on-surface">{meta.label}</span>
              {hint && (
                <span className="block font-body-md text-[11px] text-on-surface-variant">{hint}</span>
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

/** Strip-of-paper mock-up reflecting the current toggle/order state with
 *  placeholder order data — updates live, no round trip to the agent. */
function ReceiptPreview({
  sections,
  footerMessage,
  context,
  money,
}: {
  sections: ReceiptSection[];
  footerMessage: string;
  context: ReceiptContext | null;
  money: (cents: number) => string;
}) {
  const subtotal = SAMPLE_ITEMS.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const taxRate = context?.taxRate ?? 0;
  const tax = Math.round(subtotal * taxRate);
  const total = subtotal + tax;
  const tendered = total + 30;
  const upiUrl =
    context?.upiId &&
    buildUpiPaymentUrl({
      upiId: context.upiId,
      payeeName: context.tenantName,
      amountCents: total,
      note: "Sample receipt",
    });

  return (
    <div className="rounded-card border border-outline-variant bg-surface-container-lowest p-lg">
      <p className="mb-md font-label-md text-label-md uppercase tracking-wider text-on-surface-variant">
        Live Preview
      </p>
      <div className="mx-auto max-w-[280px] rounded-sm bg-white px-md py-lg font-data-mono text-[11px] leading-snug text-black shadow-inner">
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
                <div key="header" className="mb-sm text-center">
                  <p className="font-bold">{context?.tenantName ?? "Restaurant Name"}</p>
                  {context?.gstNumber && <p>GST: {context.gstNumber}</p>}
                </div>
              );
            case "orderInfo":
              return (
                <div key="orderInfo" className="mb-sm border-b border-dashed border-black/30 pb-sm text-center">
                  <p>T4 - Check #A1B2C3</p>
                  <p>{new Date().toLocaleString()}</p>
                </div>
              );
            case "lineItems":
              return (
                <div key="lineItems" className="mb-sm border-b border-dashed border-black/30 pb-sm">
                  {SAMPLE_ITEMS.map((item) => (
                    <div key={item.name}>
                      <div className="flex justify-between">
                        <span>
                          {item.qty}x {item.name}
                        </span>
                        <span>{money(item.unitPrice * item.qty)}</span>
                      </div>
                      {item.modifiers.map((m) => (
                        <p key={m} className="pl-md text-black/60">
                          {m}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              );
            case "totals":
              return (
                <div key="totals" className="mb-sm">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{money(subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tax ({(taxRate * 100).toFixed(1)}%)</span>
                    <span>{money(tax)}</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>TOTAL</span>
                    <span>{money(total)}</span>
                  </div>
                </div>
              );
            case "paymentMethod":
              return (
                <div key="paymentMethod" className="mb-sm">
                  <p>Paid via CASH</p>
                  <div className="flex justify-between">
                    <span>Tendered</span>
                    <span>{money(tendered)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Change</span>
                    <span>{money(tendered - total)}</span>
                  </div>
                </div>
              );
            case "upiQr":
              return (
                <div key="upiQr" className="mb-sm flex flex-col items-center gap-1">
                  {upiUrl ? (
                    <QRCodeCanvas value={upiUrl} size={64} level="M" />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center border border-dashed border-black/30 text-center text-[8px] text-black/40">
                      no UPI ID
                    </div>
                  )}
                  <p>Scan to pay via UPI</p>
                </div>
              );
            case "reviewQr":
              return (
                <div key="reviewQr" className="mb-sm flex flex-col items-center gap-1">
                  {context?.reviewLink ? (
                    <QRCodeCanvas value={context.reviewLink} size={64} level="M" />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center border border-dashed border-black/30 text-center text-[8px] text-black/40">
                      no review link
                    </div>
                  )}
                  <p>Scan to rate your experience</p>
                </div>
              );
            case "footer":
              return (
                <p key="footer" className="text-center">
                  {footerMessage}
                </p>
              );
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
}
