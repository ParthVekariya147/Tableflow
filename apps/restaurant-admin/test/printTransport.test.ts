import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * Transport selection is the whole mobile/PWA fix. If this decision is wrong,
 * a phone either (a) attempts a call the browser blocks as mixed content and
 * the print silently fails, or (b) needlessly routes a same-machine desktop
 * job through the cloud and loses the offline-capable fast path.
 *
 * `printAgent` imports the app's api-client singleton, so stub it — these tests
 * are about the decision, not the network.
 */
vi.mock("../src/lib/api", () => ({
  api: { print: { job: vi.fn(), status: vi.fn() } },
}));

const { directWouldBeBlocked } = await import("../src/lib/printAgent");

function pageOn(protocol: "http:" | "https:") {
  vi.stubGlobal("window", { location: { protocol } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("directWouldBeBlocked — https page (phone, installed PWA, iOS)", () => {
  it("blocks a plain-http LAN agent (the mixed-content case that broke mobile)", () => {
    pageOn("https:");
    expect(directWouldBeBlocked("http://192.168.1.50:9200")).toBe(true);
    expect(directWouldBeBlocked("http://printer.local:9200")).toBe(true);
    expect(directWouldBeBlocked("http://10.0.0.7:9200")).toBe(true);
  });

  it("allows localhost, which every engine treats as a secure context", () => {
    // A desktop till running the agent on the same machine keeps its direct,
    // internet-independent path even when the admin is served over https.
    pageOn("https:");
    expect(directWouldBeBlocked("http://localhost:9200")).toBe(false);
    expect(directWouldBeBlocked("http://127.0.0.1:9200")).toBe(false);
  });

  it("allows an https agent", () => {
    pageOn("https:");
    expect(directWouldBeBlocked("https://agent.example.com:9200")).toBe(false);
  });

  it("treats an unparseable agent URL as blocked rather than attempting it", () => {
    pageOn("https:");
    expect(directWouldBeBlocked("not a url")).toBe(true);
  });
});

describe("directWouldBeBlocked — http page (today's LAN desktop)", () => {
  it("never blocks: existing desktop behaviour is preserved exactly", () => {
    pageOn("http:");
    expect(directWouldBeBlocked("http://192.168.1.50:9200")).toBe(false);
    expect(directWouldBeBlocked("http://localhost:9200")).toBe(false);
    expect(directWouldBeBlocked("not a url")).toBe(false);
  });
});

describe("directWouldBeBlocked — non-browser", () => {
  it("does not throw when there is no window (SSR / tests)", () => {
    vi.stubGlobal("window", undefined);
    expect(() => directWouldBeBlocked("http://192.168.1.50:9200")).not.toThrow();
    expect(directWouldBeBlocked("http://192.168.1.50:9200")).toBe(false);
  });
});
