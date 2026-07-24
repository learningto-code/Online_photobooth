/**
 * Minimal Web Audio helper for the countdown beep + shutter click.
 * `unlock()` MUST be called from a user gesture (the Start tap) or the
 * browser autoplay policy will keep the AudioContext suspended.
 */
let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* audio is best-effort */
  }
}

function tone(freq: number, dur: number, vol: number): void {
  if (!ctx || ctx.state !== "running") return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + dur);
}

/** A countdown tick. Pass `final` for the higher-pitched "get ready" beep. */
export function beep(final = false): void {
  tone(final ? 1180 : 760, 0.14, 0.18);
}

/** Camera shutter click. */
export function shutter(): void {
  tone(1500, 0.05, 0.22);
  setTimeout(() => tone(900, 0.04, 0.16), 40);
}
