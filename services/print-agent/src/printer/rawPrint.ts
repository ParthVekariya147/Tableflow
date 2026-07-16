import { Socket } from "node:net";
import type { PrinterSettings } from "@amber/domain";
import { PrinterConfigError } from "./connect.js";
import { osPrintDriver } from "./osPrintDriver.js";

export function sendRawPrint(
  settings: PrinterSettings,
  data: Buffer,
): Promise<void> {
  switch (settings.connectionType) {
    case "network":
      return sendRawNetwork(settings, data);
    case "usb": {
      if (!settings.usbPath)
        throw new PrinterConfigError("USB printer is not configured");
      return sendRawOsQueue(settings.usbPath, data);
    }
    case "bluetooth": {
      if (!settings.bluetoothPort) {
        throw new PrinterConfigError("Bluetooth printer is not configured");
      }
      return sendRawOsQueue(settings.bluetoothPort, data);
    }
    default:
      throw new PrinterConfigError(
        `Unknown connection type: ${String(settings.connectionType)}`,
      );
  }
}

function sendRawOsQueue(printer: string, data: Buffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    osPrintDriver.printDirect({
      data,
      printer,
      success: () => resolve(),
      error: reject,
    });
  });
}

function sendRawNetwork(
  settings: PrinterSettings,
  data: Buffer,
): Promise<void> {
  const host = settings.networkHost;
  if (!host) {
    throw new PrinterConfigError("Network printer host is not configured");
  }
  return new Promise<void>((resolve, reject) => {
    const socket = new Socket();
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };

    socket.setTimeout(8000, () =>
      finish(new Error("Printer connection timed out")),
    );
    socket.once("error", finish);
    socket.connect(settings.networkPort ?? 9100, host, () => {
      socket.write(data, (err) => {
        if (err) finish(err);
        else socket.end();
      });
    });
    socket.once("close", () => finish());
  });
}
