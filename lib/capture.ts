/**
 * Capture a single RAW frame from the live <video> into an offscreen canvas.
 *
 * - Cover-crops the video to the target aspect (matches CSS `object-fit: cover`
 *   in the preview, so the saved frame equals what the user framed).
 * - Mirrors by default so the photo matches the mirrored selfie preview.
 * - No filter is baked here — filters (and frames) are chosen AFTER capture and
 *   applied at compose time, so the same shots can be re-styled freely.
 */
export function captureFrame(
  video: HTMLVideoElement,
  targetW: number,
  targetH: number,
  mirror = true,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const vw = video.videoWidth || targetW;
  const vh = video.videoHeight || targetH;

  const targetAspect = targetW / targetH;
  const videoAspect = vw / vh;
  let sw = vw;
  let sh = vh;
  let sx = 0;
  let sy = 0;
  if (videoAspect > targetAspect) {
    sw = Math.round(vh * targetAspect);
    sx = Math.round((vw - sw) / 2);
  } else {
    sh = Math.round(vw / targetAspect);
    sy = Math.round((vh - sh) / 2);
  }

  ctx.save();
  if (mirror) {
    ctx.translate(targetW, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, targetW, targetH);
  ctx.restore();

  return canvas;
}

/** Free a canvas's backing memory (important on iOS Safari). */
export function releaseCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}
