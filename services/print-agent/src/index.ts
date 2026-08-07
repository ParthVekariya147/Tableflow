import express from "express";
import cors from "cors";
import { printRouter } from "./routes/print.js";
import { kotRouter } from "./routes/kot.js";
import { RelayClient } from "./relay/relayClient.js";

const PORT = Number(process.env.PRINT_AGENT_PORT ?? 9200);
const VERSION = "0.2.0";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// No auth — returns no receipt data, and must work before a secret is
// configured on either side (Settings → Printer's "Test Connection").
app.get("/health", (_req, res) => {
  res.json({ ok: true, version: VERSION });
});

app.use(printRouter);
app.use(kotRouter);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Print agent listening on http://0.0.0.0:${PORT}`);
  if (!process.env.AGENT_SECRET) {
    console.warn(
      "AGENT_SECRET is not set — running in OPEN mode. Only safe if this agent " +
        "and the printer stay on the same PC as the browser.",
    );
  }
});

/**
 * Cloud relay (optional, additive).
 *
 * The LAN server above is unchanged and still serves a desktop till on the same
 * machine. The relay is what lets phones, tablets and installed PWAs print:
 * the agent dials the API and holds the connection open, so no browser ever has
 * to reach a `http://` LAN address from an `https://` page.
 *
 * Enabled by pointing the agent at an API and a restaurant:
 *   AMBER_API_URL=https://api.tableflow.app
 *   AMBER_TENANT_SLUG=amber-grain
 *   AGENT_SECRET=<the same key saved in Settings → Printer>
 * Unset any of these and the agent behaves exactly as it did before.
 */
const apiUrl = process.env.AMBER_API_URL;
const tenantSlug = process.env.AMBER_TENANT_SLUG;
const agentSecret = process.env.AGENT_SECRET;

if (apiUrl && tenantSlug && agentSecret) {
  const relay = new RelayClient({
    apiUrl,
    tenantSlug,
    agentSecret,
    agentName: process.env.AGENT_NAME,
    version: VERSION,
  });
  void relay.start();
  const shutdown = () => {
    relay.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} else if (apiUrl || tenantSlug) {
  console.warn(
    "[relay] disabled — AMBER_API_URL, AMBER_TENANT_SLUG and AGENT_SECRET must ALL be set. " +
      "Local LAN printing is unaffected.",
  );
}
