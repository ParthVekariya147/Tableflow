import { execFile } from "node:child_process";
import { platform } from "node:os";
import type { PrinterSettings } from "@amber/domain";

/**
 * What the OS print driver reports about the installed printer: the stock
 * (paper) size configured/loaded and the head resolution. The printer itself
 * can't be asked over raw TSPL/ESC-POS — but the driver on the agent's PC
 * knows, which is exactly the "the system already knows what page is inside"
 * source Settings → Printer's "Detect from printer" reads.
 */
export interface DetectedPrinterInfo {
  /** Resolved OS queue name (after share-name matching). */
  printer: string;
  paperWidthMm: number;
  paperHeightMm?: number;
  /** Driver's own stock name, e.g. "4.00" or "User defined". */
  paperName?: string;
  /** Head resolution in dpi (e.g. 203 or 300), when the driver reports one. */
  dpi?: number;
}

/**
 * Query the OS driver for the configured paper size + resolution. Only
 * possible for printers installed on the agent's PC (`usb` / `bluetooth`
 * connections); a raw `network` :9100 target has no driver to ask.
 */
export async function queryPrinterInfo(
  settings: PrinterSettings,
): Promise<DetectedPrinterInfo> {
  const queue =
    settings.connectionType === "bluetooth"
      ? settings.bluetoothPort
      : settings.usbPath;
  if (settings.connectionType === "network" || !queue) {
    throw new Error(
      "Paper detection reads the OS printer driver, so it needs the USB/Bluetooth " +
        "connection type with the installed printer's name — a raw network printer " +
        "has no driver to ask.",
    );
  }
  if (platform() !== "win32") {
    throw new Error(
      "Paper detection is currently supported only on Windows print agents.",
    );
  }
  return queryWindows(queue);
}

function queryWindows(printer: string): Promise<DetectedPrinterInfo> {
  // Same queue resolution as osPrintDriver (match by Name OR ShareName), then
  // System.Drawing exposes the driver's DEVMODE: PaperSize in hundredths of
  // an inch, PrinterResolution in dpi.
  const script = `
$ErrorActionPreference = 'Stop'
$printerName = $env:AMBER_PRINTER_NAME
$match = Get-Printer -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq $printerName -or $_.ShareName -eq $printerName } |
  Select-Object -First 1
if ($match) {
  $printerName = $match.Name
}
Add-Type -AssemblyName System.Drawing
$ps = New-Object System.Drawing.Printing.PrinterSettings
$ps.PrinterName = $printerName
if (-not $ps.IsValid) { throw "Printer '$printerName' is not installed on this PC." }
$page = $ps.DefaultPageSettings
$size = $page.PaperSize
$res = $page.PrinterResolution
$dpi = [math]::Max($res.X, $res.Y)
[pscustomobject]@{
  printer = $printerName
  paperWidthMm = [math]::Round($size.Width * 0.254, 1)
  paperHeightMm = [math]::Round($size.Height * 0.254, 1)
  paperName = $size.PaperName
  dpi = if ($dpi -gt 0) { $dpi } else { $null }
} | ConvertTo-Json -Compress
`;

  return new Promise<DetectedPrinterInfo>((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        env: { ...process.env, AMBER_PRINTER_NAME: printer },
        windowsHide: true,
        timeout: 15000,
      },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr.trim() || err.message));
          return;
        }
        try {
          const raw = JSON.parse(stdout.trim()) as {
            printer?: unknown;
            paperWidthMm?: unknown;
            paperHeightMm?: unknown;
            paperName?: unknown;
            dpi?: unknown;
          };
          const widthMm = Number(raw.paperWidthMm);
          if (!Number.isFinite(widthMm) || widthMm <= 0)
            throw new Error("Driver returned no usable paper width.");
          resolve({
            printer: typeof raw.printer === "string" ? raw.printer : printer,
            paperWidthMm: widthMm,
            paperHeightMm: Number.isFinite(Number(raw.paperHeightMm))
              ? Number(raw.paperHeightMm)
              : undefined,
            paperName:
              typeof raw.paperName === "string" ? raw.paperName : undefined,
            dpi: Number.isFinite(Number(raw.dpi)) && Number(raw.dpi) > 0
              ? Number(raw.dpi)
              : undefined,
          });
        } catch (parseErr) {
          reject(
            parseErr instanceof Error
              ? parseErr
              : new Error("Couldn't read the driver's paper settings."),
          );
        }
      },
    );
  });
}
