import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { platform } from "node:os";

interface PrintDirectArgs {
  data: Buffer;
  printer: string;
  success?: (jobId?: string) => void;
  error?: (err: Error) => void;
}

/**
 * Minimal node-thermal-printer `driver` for the "printer:<name>" (OS print
 * queue) interface, used for both `usb` and `bluetooth` connection types once
 * the printer is installed/paired at the OS level. Deliberately hand-rolled
 * instead of depending on the `printer` / `@thiagoelg/node-printer` npm
 * packages: both are native (node-gyp) addons — `printer` is unmaintained and
 * its install script pulls in a broken `grunt-node-gyp` peer dependency, and
 * `@thiagoelg/node-printer` has no prebuilt binary for current Node/Windows
 * combos, so it falls back to node-gyp and fails without a full Visual Studio
 * C++ toolchain — not something a restaurant PC has installed. This avoids
 * native compilation entirely:
 * - **Windows**: writes raw bytes straight to the printer's share (the same
 *   mechanism as `copy /b file.prn \\localhost\PrinterName` from cmd.exe) —
 *   requires the printer to be shared at the OS level (Printer Properties →
 *   Sharing), not just installed.
 * - **macOS/Linux**: pipes the buffer to CUPS's `lp -d <name> -o raw`, present
 *   by default on macOS and on any Linux with `cups-client` installed.
 * Only `printDirect` is implemented — the only driver method node-thermal-printer
 * calls when a specific (non-"auto") printer name is configured, which is
 * always the case here (`usbPath`/`bluetoothPort` are required, explicit names).
 */
export const osPrintDriver = {
  printDirect({ data, printer, success, error }: PrintDirectArgs): void {
    const send =
      platform() === "win32"
        ? writeFile(`\\\\localhost\\${printer}`, data)
        : new Promise<void>((resolve, reject) => {
            const proc = execFile("lp", ["-d", printer, "-o", "raw"], (err) => {
              if (err) reject(err);
              else resolve();
            });
            proc.stdin?.end(data);
          });
    send
      .then(() => success?.())
      .catch((err: unknown) => error?.(err instanceof Error ? err : new Error(String(err))));
  },
};
