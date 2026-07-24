/**
 * Layout / format definitions and geometry.
 *
 * Each layout is a SINGLE image (one strip or one grid) with its own canvas
 * size — no duplicated side-by-side strips. A layout is a grid of `cols × rows`
 * photo cells plus a footer band. The derived cell aspect is used as both the
 * live-preview slot shape and the capture aspect (WYSIWYG framing).
 */

export type LayoutId = "strip-4" | "grid-2x2";

export interface LayoutDef {
  id: LayoutId;
  name: string;
  description: string;
  /** Number of photos (and the number the user selects). */
  shots: number;
  cols: number;
  rows: number;
  /** Output pixel dimensions for this layout. */
  canvas: { w: number; h: number };
}

export const COMPOSE = {
  outerMargin: 30,
  cellGap: 18,
  footer: 150,
  cornerRadius: 14,
} as const;

export const LAYOUTS: LayoutDef[] = [
  {
    id: "strip-4",
    name: "Classic strip",
    description: "Four photos in one column",
    shots: 4,
    cols: 1,
    rows: 4,
    canvas: { w: 760, h: 2100 },
  },
  {
    id: "grid-2x2",
    name: "2×2 grid",
    description: "Four photos in a square",
    shots: 4,
    cols: 2,
    rows: 2,
    canvas: { w: 1200, h: 1320 },
  },
];

export const DEFAULT_LAYOUT_ID: LayoutId = "strip-4";

/** Extra frames to shoot beyond what the layout needs (pick-your-best). */
export const EXTRA_SHOTS = 2;

export function getLayout(idOrNull: string | undefined): LayoutDef {
  return LAYOUTS.find((l) => l.id === idOrNull) ?? LAYOUTS[0];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ComputedLayout {
  slots: Rect[];
  footer: Rect;
  /** Cell aspect (w/h) — preview slot shape and capture aspect. */
  captureAspect: number;
  canvas: { w: number; h: number };
}

/** Turn a layout into concrete pixel rects. */
export function computeLayout(layout: LayoutDef): ComputedLayout {
  const { w: W, h: H } = layout.canvas;
  const { outerMargin: m, cellGap: gap, footer } = COMPOSE;

  const contentW = W - 2 * m;
  const contentH = H - 2 * m - footer;

  const cellW = (contentW - (layout.cols - 1) * gap) / layout.cols;
  const cellH = (contentH - (layout.rows - 1) * gap) / layout.rows;

  const slots: Rect[] = [];
  for (let r = 0; r < layout.rows; r++) {
    for (let c = 0; c < layout.cols; c++) {
      slots.push({
        x: m + c * (cellW + gap),
        y: m + r * (cellH + gap),
        w: cellW,
        h: cellH,
      });
    }
  }

  return {
    slots,
    footer: { x: m, y: m + contentH, w: contentW, h: footer },
    captureAspect: cellW / cellH,
    canvas: layout.canvas,
  };
}

/** Pixel size to capture each frame at, given a cell aspect. */
export function captureSize(aspect: number, maxLongEdge = 1280): { w: number; h: number } {
  if (aspect >= 1) {
    const w = maxLongEdge;
    return { w, h: Math.round(w / aspect) };
  }
  const h = maxLongEdge;
  return { w: Math.round(h * aspect), h };
}
