import {
  CharacterSet,
  ThermalPrinter,
  PrinterTypes,
} from "node-thermal-printer";
import { printerColumns, type PrinterSettings } from "@amber/domain";
import { osPrintDriver } from "./osPrintDriver.js";

/** Thrown for a missing/incomplete connection config — a 400, not a printer failure. */
export class PrinterConfigError extends Error {}

/**
 * Builds a node-thermal-printer instance for the given connection config.
 * Network talks raw ESC/POS over TCP directly to the printer's IP. USB and
 * Bluetooth both resolve to the OS-level print queue — the practical, reliable
 * path once the printer is installed (USB) or paired (Bluetooth) at the OS
 * level and exposed as a named printer/port; `usbPath`/`bluetoothPort` are
 * that system identifier, not a raw device/MAC address. The `printer:` interface
 * requires an explicit `driver` (node-thermal-printer has no default) — without
 * one it throws "No driver set!" on every request, which is what `osPrintDriver`
 * fixes; network needs no driver at all.
 */
export function buildPrinter(settings: PrinterSettings): ThermalPrinter {
  return new ThermalPrinter({
    type: PrinterTypes.EPSON,
    interface: resolveInterface(settings),
    driver: settings.connectionType === "network" ? undefined : osPrintDriver,
    // buildPrinter is only reached on the ESC/POS path (TSPL goes raw), so
    // pin the language — a "tspl"-flagged config must not get TSPL columns here.
    width: printerColumns({ ...settings, commandLanguage: "escpos" }),
    characterSet: CharacterSet.PC437_USA,
    removeSpecialCharacters: false,
  });
}

function resolveInterface(settings: PrinterSettings): string {
  switch (settings.connectionType) {
    case "network": {
      if (!settings.networkHost) {
        throw new PrinterConfigError("Network printer host is not configured");
      }
      return `tcp://${settings.networkHost}:${settings.networkPort ?? 9100}`;
    }
    case "usb": {
      if (!settings.usbPath) {
        throw new PrinterConfigError("USB printer is not configured");
      }
      return `printer:${settings.usbPath}`;
    }
    case "bluetooth": {
      if (!settings.bluetoothPort) {
        throw new PrinterConfigError("Bluetooth printer is not configured");
      }
      return `printer:${settings.bluetoothPort}`;
    }
    default:
      throw new PrinterConfigError(
        `Unknown connection type: ${String(settings.connectionType)}`,
      );
  }
}
