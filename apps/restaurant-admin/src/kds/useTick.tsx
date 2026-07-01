import { useEffect, useState } from "react";

/** Re-render every `ms` so live clocks / elapsed timers update. Returns a
 *  monotonically changing value (the current epoch ms). */
export function useTick(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * Self-contained live clock. Isolated into its own component so the 1x/second
 * re-render it needs doesn't propagate to its parent (KdsPage used to call
 * `useTick` directly, forcing the whole board — every column, every ticket —
 * to re-derive on every tick just to redraw this one label).
 */
export function Clock() {
  const now = useTick(1000);
  const clock = new Date(now).toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return <>{clock}</>;
}

/** Format seconds as MM:SS. */
export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
