import { execFile } from "node:child_process";
import { platform } from "node:os";
import type { RelayPrinter } from "@amber/domain";

/**
 * Advertise the printers this agent can reach, so the admin can show staff
 * what's available and target a specific one (multi-printer support). Purely
 * informational — a job still carries its own connection config, so discovery
 * failing never blocks printing.
 */
export async function listSystemPrinters(): Promise<RelayPrinter[]> {
  try {
    const names =
      platform() === "win32" ? await windowsPrinters() : await cupsPrinters();
    return names.slice(0, 50).map((name) => ({
      id: name,
      label: name,
      role: guessRole(name),
    }));
  } catch {
    return [];
  }
}

/** A best-effort hint for the admin UI; never authoritative. */
function guessRole(name: string): RelayPrinter["role"] {
  if (/kitchen|kot|kds/i.test(name)) return "kitchen";
  if (/receipt|pos|tsc|thermal|80mm|58mm/i.test(name)) return "receipt";
  return "other";
}

function windowsPrinters(): Promise<string[]> {
  return run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "Get-Printer | Select-Object -ExpandProperty Name",
  ]);
}

function cupsPrinters(): Promise<string[]> {
  return run("lpstat", ["-e"]);
}

function run(cmd: string, args: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: 10_000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(
          stdout
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean),
        );
      },
    );
  });
}
