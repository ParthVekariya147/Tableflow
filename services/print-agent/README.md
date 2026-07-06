# @amber/print-agent

A small local HTTP service that bridges the restaurant-admin web app to a
thermal receipt printer (USB, Bluetooth, or Network). Browsers can't reliably
talk to printers directly, so this process — running on the same PC as the
browser, or on another device on the same local network — owns the printer
connection and prints on request. It's stateless: every request carries the
receipt content **and** the printer connection details, which the web app
manages in Settings → Printer.

## Run it

```
cd services/print-agent
pnpm install
pnpm dev      # tsx watch, for local development
# or, for a long-running install:
pnpm build && pnpm start
```

Defaults to port `9200` (override with `PRINT_AGENT_PORT`). Must be reachable
from the browser at the URL entered in Settings → Printer → Agent URL —
`http://localhost:9200` if the agent runs on the same PC as the browser, or
`http://<LAN-IP>:9200` if it runs on a separate machine near the printer.

## Securing it (recommended when the printer is on a different device)

Set an `AGENT_SECRET` environment variable before starting the agent, and
enter the **same value** as the "Security key" in Settings → Printer. Every
`/print` and `/print/test` request must then include a matching
`X-Agent-Secret` header or the agent rejects it with 401. Leaving
`AGENT_SECRET` unset runs the agent in open mode — only safe when the agent
and the printer never leave the same PC as the browser.

```
AGENT_SECRET=some-long-random-value pnpm start
```

## Endpoints

- `GET /health` — `{ ok, version }`. No auth required.
- `POST /print/test` — `{ connection }`. Prints a short test slip.
- `POST /print` — `{ connection, receipt }`. Formats and prints a full receipt.

Both `/print*` endpoints respond `{ success: true }` or
`{ success: false, error }`, with a `400` for a bad/incomplete `connection`
config and a `502` for an actual printer failure (offline, timed out, etc.) —
this lets the web app tell "printer isn't set up" apart from "printer isn't
responding."

## Connection types

- **network** — `networkHost` + `networkPort` (default `9100`), talks raw
  ESC/POS over TCP straight to the printer's IP.
- **usb** / **bluetooth** — both resolve to an OS-level print queue: install
  the printer (USB) or pair it (Bluetooth) at the operating-system level first
  so it's addressable by a system printer/port name, then enter that name as
  `usbPath` / `bluetoothPort`. Sending to that queue is handled by
  `printer/osPrintDriver.ts` — a small hand-rolled driver with **no native
  (node-gyp) dependency**, so `pnpm install` never needs a C++ toolchain on
  the staff PC:
  - **Windows**: the printer must also be **shared** (Printer Properties →
    Sharing → "Share this printer"), not just installed — the driver writes
    raw bytes straight to `\\localhost\<share name>`, so `usbPath`/
    `bluetoothPort` must be the **share name**, not the display name, if they
    differ.
  - **macOS/Linux**: pipes to CUPS's `lp -d <name> -o raw`, present by default
    on macOS and on Linux distros with `cups-client` installed.
