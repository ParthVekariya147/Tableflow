/**
 * One-command dev orchestrator.
 *
 * The customer app (:5173) and the KDS board (:5174) are different origins, so
 * they sync through the tiny KDS relay (:4001) — see tools/kds-relay.mjs. That
 * relay is the live pipeline; without it, orders never reach the kitchen and
 * status never reflects back. This script starts the relay AND the Turbo dev
 * servers together so `pnpm dev` brings the whole pipeline up at once.
 *
 * Turbo runs in streaming UI mode (not the fullscreen TUI) so the relay's log
 * lines interleave cleanly with each app's output.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { syncLanEnv } from "./sync-lan-env.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const relayScript = join(here, "kds-relay.mjs");

const children = [];

/** Spawn a child, prefixing each of its log lines so output stays readable. */
function run(label, command, args, { shell = false } = {}) {
  const child = spawn(command, args, { stdio: ["inherit", "pipe", "pipe"], shell });
  const prefix = (line) => `[${label}] ${line}`;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) out.write(prefix(line) + "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    process.stdout.write(prefix(`exited (${code})\n`));
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (!c.killed) c.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// Sync LAN IP into .env files so phones on the same Wi-Fi reach the API.
syncLanEnv();

// KDS relay first so it's listening before the apps connect.
run("kds-relay", process.execPath, [relayScript]);
// Turbo dev servers (customer, restaurant-admin, super-admin) in streaming mode.
// shell:true is required on Windows Node 24 to spawn .cmd shims (pnpm.cmd).
run("turbo", "pnpm", ["exec", "turbo", "run", "dev", "--ui=stream"], {
  shell: process.platform === "win32",
});
