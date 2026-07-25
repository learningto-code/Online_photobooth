import { COMPOSE, computeLayout, LayoutDef, Rect } from "./layouts";
import { FrameStyle } from "./frames";

export type Drawable = HTMLCanvasElement | ImageBitmap;

export interface ComposeResult {
  blob: Blob;
  url: string;
  width: number;
  height: number;
}

export interface ComposeInput {
  /** Chosen frames in slot order; length must equal layout.shots. */
  frames: HTMLCanvasElement[];
  layout: LayoutDef;
  style: FrameStyle;
  /** CSS/canvas filter string applied at compose time ("none" for raw). */
  filterCss: string;
  caption: string;
  dateStr: string;
  /** Optional custom background image drawn (cover) behind the photos. */
  bgImage?: Drawable | null;
}

export interface ComposeMultiInput {
  /** Per slot, the participants' frames in a stable order (null = missing). */
  slots: Array<Array<Drawable | null>>;
  layout: LayoutDef;
  style: FrameStyle;
  filterCss: string;
  caption: string;
  dateStr: string;
  bgImage?: Drawable | null;
}

// No gap between participants — their photos combine seamlessly in one cut.
const SUB_GAP = 0;

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, rr);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** drawImage a source into a rect using object-fit: cover semantics. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  iw: number,
  ih: number,
  dest: Rect,
): void {
  const targetAspect = dest.w / dest.h;
  const imgAspect = iw / ih;
  let sw = iw;
  let sh = ih;
  let sx = 0;
  let sy = 0;
  if (imgAspect > targetAspect) {
    sw = ih * targetAspect;
    sx = (iw - sw) / 2;
  } else {
    sh = iw / targetAspect;
    sy = (ih - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, dest.x, dest.y, dest.w, dest.h);
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  f: Rect,
  style: FrameStyle,
  caption: string,
  dateStr: string,
): void {
  const cx = f.x + f.w / 2;
  ctx.filter = "none";
  ctx.fillStyle = style.textColor;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const capSize = Math.max(22, Math.round(f.h * 0.26));
  ctx.font = `700 ${capSize}px Arial, Helvetica, sans-serif`;
  ctx.fillText(caption.toUpperCase(), cx, f.y + f.h * 0.42, f.w - 24);

  const dateSize = Math.max(16, Math.round(f.h * 0.18));
  ctx.font = `400 ${dateSize}px Arial, Helvetica, sans-serif`;
  ctx.globalAlpha = 0.78;
  ctx.fillText(dateStr, cx, f.y + f.h * 0.74, f.w - 24);
  ctx.globalAlpha = 1;
}

function normFilter(css: string): string {
  return css && css !== "none" ? css : "none";
}

async function finish(canvas: HTMLCanvasElement): Promise<ComposeResult> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
  const result: ComposeResult = {
    blob,
    url: URL.createObjectURL(blob),
    width: canvas.width,
    height: canvas.height,
  };
  canvas.width = 0;
  canvas.height = 0;
  return result;
}

function newCanvas(
  layout: LayoutDef,
  style: FrameStyle,
  bgImage?: Drawable | null,
): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement("canvas");
  canvas.width = layout.canvas.w;
  canvas.height = layout.canvas.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.fillStyle = style.sheetBg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (bgImage) {
    drawCover(ctx, bgImage, bgImage.width, bgImage.height, {
      x: 0,
      y: 0,
      w: canvas.width,
      h: canvas.height,
    });
  }
  return { canvas, ctx };
}

/** Single-photo-per-slot layout (solo booth). */
export async function composeSheet(input: ComposeInput): Promise<ComposeResult> {
  const { frames, layout, style, filterCss, caption, dateStr, bgImage } = input;
  const { canvas, ctx } = newCanvas(layout, style, bgImage);
  const { slots, footer } = computeLayout(layout);
  const filter = normFilter(filterCss);

  slots.forEach((slot, i) => {
    const frame = frames[i];
    if (!frame) return;
    ctx.save();
    roundRectPath(ctx, slot.x, slot.y, slot.w, slot.h, COMPOSE.cornerRadius);
    ctx.clip();
    ctx.filter = filter;
    drawCover(ctx, frame, frame.width, frame.height, slot);
    ctx.restore();
  });

  drawFooter(ctx, footer, style, caption, dateStr);
  return finish(canvas);
}

/** Multi-participant layout: each slot is split into columns, one per person. */
export async function composeSheetMulti(input: ComposeMultiInput): Promise<ComposeResult> {
  const { slots: people, layout, style, filterCss, caption, dateStr, bgImage } = input;
  const { canvas, ctx } = newCanvas(layout, style, bgImage);
  const { slots, footer } = computeLayout(layout);
  const filter = normFilter(filterCss);

  slots.forEach((slot, i) => {
    const row = people[i] ?? [];
    const p = Math.max(1, row.length);
    const colW = (slot.w - (p - 1) * SUB_GAP) / p;

    ctx.save();
    roundRectPath(ctx, slot.x, slot.y, slot.w, slot.h, COMPOSE.cornerRadius);
    ctx.clip();
    ctx.filter = filter;
    row.forEach((frame, k) => {
      if (!frame) return;
      drawCover(ctx, frame, frame.width, frame.height, {
        x: slot.x + k * (colW + SUB_GAP),
        y: slot.y,
        w: colW,
        h: slot.h,
      });
    });
    ctx.restore();
  });

  drawFooter(ctx, footer, style, caption, dateStr);
  return finish(canvas);
}

/** Per-person capture aspect for a slot split among `participants` people. */
export function subSlotAspect(slotW: number, slotH: number, participants: number): number {
  const p = Math.max(1, participants);
  const colW = (slotW - (p - 1) * SUB_GAP) / p;
  return colW / slotH;
}
