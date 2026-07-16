import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";

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
        ? printRawWindows(printer, data)
        : printRawCups(printer, data);
    send
      .then(() => success?.())
      .catch((err: unknown) =>
        error?.(err instanceof Error ? err : new Error(String(err))),
      );
  },
};

function printRawCups(printer: string, data: Buffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = execFile("lp", ["-d", printer, "-o", "raw"], (err) => {
      if (err) reject(err);
      else resolve();
    });
    proc.stdin?.end(data);
  });
}

async function printRawWindows(printer: string, data: Buffer): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "amber-print-"));
  const path = join(dir, "job.prn");
  try {
    await writeFile(path, data);
    await runPowerShellRawPrint(printer, path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runPowerShellRawPrint(printer: string, path: string): Promise<void> {
  const script = `
$printerName = $env:AMBER_PRINTER_NAME
$jobPath = $env:AMBER_PRINT_JOB_PATH
$match = Get-Printer -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq $printerName -or $_.ShareName -eq $printerName } |
  Select-Object -First 1
if ($match) {
  $printerName = $match.Name
}
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOC_INFO_1 {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }

  [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOC_INFO_1 di);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

  private static void ThrowLastError() {
    throw new Win32Exception(Marshal.GetLastWin32Error());
  }

  public static void SendBytes(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) ThrowLastError();
    try {
      DOC_INFO_1 doc = new DOC_INFO_1();
      doc.pDocName = "Amber Print Agent";
      doc.pDataType = "RAW";
      if (!StartDocPrinter(hPrinter, 1, doc)) ThrowLastError();
      try {
        if (!StartPagePrinter(hPrinter)) ThrowLastError();
        try {
          int written;
          if (!WritePrinter(hPrinter, bytes, bytes.Length, out written)) ThrowLastError();
          if (written != bytes.Length) throw new Exception("Windows accepted only " + written + " of " + bytes.Length + " bytes.");
        } finally {
          EndPagePrinter(hPrinter);
        }
      } finally {
        EndDocPrinter(hPrinter);
      }
    } finally {
      ClosePrinter(hPrinter);
    }
  }
}
'@
[RawPrinterHelper]::SendBytes($printerName, [System.IO.File]::ReadAllBytes($jobPath))
`;

  return new Promise<void>((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        env: {
          ...process.env,
          AMBER_PRINTER_NAME: printer,
          AMBER_PRINT_JOB_PATH: path,
        },
        windowsHide: true,
        timeout: 15000,
      },
      (err, _stdout, stderr) => {
        if (err) {
          reject(new Error(stderr.trim() || err.message));
          return;
        }
        resolve();
      },
    );
  });
}
