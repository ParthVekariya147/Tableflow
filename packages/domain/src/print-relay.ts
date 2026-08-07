import { z } from "zod";
import { printerSettingsSchema } from "./printer.js";
import { receiptSchema } from "./receipt.js";
import { kotSchema } from "./kot.js";

/**
 * The print RELAY contract — how a browser on any device reaches a printer
 * sitting on a restaurant's LAN.
 *
 * ## Why this exists
 * The admin is served over HTTPS; the print agent listens on plain HTTP on the
 * LAN. A browser will not let an HTTPS page call `http://192.168.x.x` (mixed
 * content), and installed PWAs and iOS Safari have no override at all. Every
 * "make the LAN reachable" fix (self-signed certs, per-device trust, port
 * forwarding, mDNS) either fails on iOS or needs per-restaurant network work
 * that does not survive 5000 sites.
 *
 * So the connection is inverted: **the agent dials out to the API and stays
 * connected.** The browser then never talks to the LAN at all — it POSTs a job
 * to the API over ordinary HTTPS (same origin), and the API pushes that job
 * down the agent's existing outbound connection. Identical behaviour on
 * desktop, Android Chrome, iOS Safari and both installed PWAs, because from
 * the browser's side it is just an API call.
 *
 * ## Transport
 * Downstream (API → agent) is Server-Sent Events: one long-lived GET the agent
 * holds open. Upstream (agent → API) is plain POST — registration and one
 * result per job, both low volume. SSE is used rather than WebSocket because
 * it needs no new dependency, reuses the SSE stack already proven here (see
 * flow 7), and survives proxies/CDNs that mangle WebSocket upgrades. Swapping
 * the downstream to WebSocket later touches only the two transport files; this
 * contract does not change.
 *
 * ## Backward compatibility
 * The agent's existing local HTTP routes (`POST /print`, `/print/test`,
 * `/print/kot`) are untouched and still work. A desktop till on the same
 * machine keeps printing directly; the relay is the path for everything that
 * cannot reach the LAN. Both paths run the SAME renderers, so output is
 * byte-identical whichever route a job takes.
 */

/** One printer an agent can reach, as advertised to the API on registration. */
export const relayPrinterSchema = z.object({
  /** Stable per agent — the OS queue name or configured address. */
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  /** Which tenant-side config this printer is intended to serve. */
  role: z.enum(["receipt", "kitchen", "other"]).default("other"),
});
export type RelayPrinter = z.infer<typeof relayPrinterSchema>;

/** What an agent tells the API about itself when its stream comes up. */
export const relayRegistrationSchema = z.object({
  /** Stable across restarts (persisted by the agent) so reconnects are not
   *  mistaken for a second till. */
  agentId: z.string().min(8).max(64),
  agentName: z.string().min(1).max(120),
  version: z.string().min(1).max(32),
  platform: z.string().min(1).max(64).optional(),
  printers: z.array(relayPrinterSchema).max(50).default([]),
});
export type RelayRegistration = z.infer<typeof relayRegistrationSchema>;

export const printJobKindSchema = z.enum(["receipt", "kot", "test"]);
export type PrintJobKind = z.infer<typeof printJobKindSchema>;

/**
 * A unit of work pushed to an agent. Carries the full printer connection
 * config, exactly like the local HTTP routes do — the agent stays stateless
 * and the tenant's saved settings remain the single source of truth.
 */
/** The job's fields, without the payload cross-checks. Exported so callers can
 *  derive shapes from it (`.omit`/`.extend`) — the refined schema below is a
 *  ZodEffects and can't be reshaped. */
export const printJobBaseSchema = z.object({
  jobId: z.string().min(8).max(64),
  kind: printJobKindSchema,
  /** Target a specific registered printer; omitted = the agent's default. */
  printerId: z.string().max(200).optional(),
  connection: printerSettingsSchema,
  receipt: receiptSchema.optional(),
  kot: kotSchema.optional(),
});

export const printJobSchema = printJobBaseSchema
  .refine((j) => j.kind !== "receipt" || j.receipt !== undefined, {
    message: "A receipt job must carry a receipt",
  })
  .refine((j) => j.kind !== "kot" || j.kot !== undefined, {
    message: "A KOT job must carry a kot",
  });
export type PrintJob = z.infer<typeof printJobSchema>;

/** Why a job failed, mirroring the local agent's 400-vs-502 distinction so the
 *  admin can tell "fix your settings" from "check the printer". */
export const printJobFailureSchema = z.enum([
  /** Bad/missing printer configuration — the tenant must fix settings. */
  "config",
  /** The printer itself refused / was unreachable. */
  "printer",
  /** No agent was connected for this tenant. */
  "offline",
  /** The agent accepted the job but never answered in time. */
  "timeout",
]);
export type PrintJobFailure = z.infer<typeof printJobFailureSchema>;

/** The agent's answer for one job, posted back up. */
export const printJobResultSchema = z.object({
  jobId: z.string().min(8).max(64),
  ok: z.boolean(),
  reason: printJobFailureSchema.optional(),
  error: z.string().max(500).optional(),
});
export type PrintJobResult = z.infer<typeof printJobResultSchema>;

/** Frames the API pushes down an agent's stream. */
export type RelayDownstreamEvent =
  /** Sent once on connect so the agent can confirm it is registered. */
  | { type: "ready"; connectionId: string }
  | { type: "job"; job: PrintJob }
  /** Keeps intermediaries from idling the connection out. */
  | { type: "ping" };

/** A connected agent as reported to staff (Settings → Printer status). */
export const connectedAgentSchema = z.object({
  agentId: z.string(),
  agentName: z.string(),
  version: z.string(),
  platform: z.string().optional(),
  printers: z.array(relayPrinterSchema),
  connectedAt: z.string(),
});
export type ConnectedAgent = z.infer<typeof connectedAgentSchema>;

/** How long the API waits for an agent to answer before giving up on a job.
 *  Comfortably longer than a thermal print (~1-3s) but short enough that a
 *  wedged agent does not hold a checkout hostage. */
export const PRINT_JOB_TIMEOUT_MS = 20_000;
