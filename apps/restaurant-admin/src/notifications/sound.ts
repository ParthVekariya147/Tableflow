// A short two-tone chime, synthesized via the Web Audio API rather than an
// audio asset file — nothing to fetch/404, zero bundle-size cost, and no
// licensing to track for a notification blip.
let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) return null;
  if (!ctx) ctx = new AudioCtx();
  return ctx;
}

/**
 * Play the "new service request" chime. Silently no-ops if the browser has
 * blocked audio (autoplay policy — needs a prior user gesture on the page,
 * which staff will already have made by clicking around the admin panel) or
 * Web Audio isn't available at all. A notification sound failing to play
 * should never surface as an error to the user.
 */
export function playServiceRequestChime(): void {
  const audioCtx = getContext();
  if (!audioCtx) return;
  try {
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const now = audioCtx.currentTime;
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.12;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    }
  } catch {
    /* audio unavailable — never let a chime break the UI */
  }
}
