/**
 * Frame (border) styles for the finished strip. For v1 the "frame" is the
 * background colour behind the photos plus the footer text colour — the
 * classic Life4Cuts look. Themed PNG overlays can be layered on later (v2)
 * by adding an `overlaySrc` field and drawing it in the compositor.
 */
export interface FrameStyle {
  id: string;
  name: string;
  /** Background of the whole sheet / strip. */
  sheetBg: string;
  /** Footer caption + date colour. */
  textColor: string;
  /** Optional swatch preview colour (defaults to sheetBg). */
  swatch?: string;
}

export const FRAMES: FrameStyle[] = [
  { id: "classic-black", name: "Classic Black", sheetBg: "#141414", textColor: "#ffffff" },
  { id: "white", name: "White", sheetBg: "#fafafa", textColor: "#1a1a1a" },
  { id: "cream", name: "Cream", sheetBg: "#f3e9d7", textColor: "#6b573c" },
  { id: "pink", name: "Sweet Pink", sheetBg: "#f6c3d2", textColor: "#8c3a54" },
  { id: "sky", name: "Sky", sheetBg: "#cae4f4", textColor: "#2f5c78" },
  { id: "sage", name: "Sage", sheetBg: "#d4e2cf", textColor: "#42583b" },
];

export const DEFAULT_FRAME_ID = "classic-black";

export function getFrame(idOrNull: string | undefined): FrameStyle {
  return FRAMES.find((f) => f.id === idOrNull) ?? FRAMES[0];
}
