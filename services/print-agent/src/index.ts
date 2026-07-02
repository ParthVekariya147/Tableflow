import express from "express";
import cors from "cors";
import { printRouter } from "./routes/print.js";
import { kotRouter } from "./routes/kot.js";

const PORT = Number(process.env.PRINT_AGENT_PORT ?? 9200);

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// No auth — returns no receipt data, and must work before a secret is
// configured on either side (Settings → Printer's "Test Connection").
app.get("/health", (_req, res) => {
  res.json({ ok: true, version: "0.1.0" });
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
