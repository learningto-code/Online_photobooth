/**
 * Filter presets. `css` is a valid value for BOTH the CSS `filter` property
 * (live <video> preview) and Canvas 2D `ctx.filter` (baked at capture) so the
 * saved frame matches what the user saw. Keep these in sync — never diverge.
 */
export interface FilterPreset {
  id: string;
  name: string;
  css: string;
}

export const FILTERS: FilterPreset[] = [
  { id: "original", name: "Original", css: "none" },
  { id: "soft", name: "Soft", css: "brightness(1.08) contrast(0.96) saturate(1.06) blur(0.4px)" },
  { id: "warm", name: "Warm Film", css: "sepia(0.32) saturate(1.18) contrast(1.05) brightness(1.03)" },
  { id: "cool", name: "Cool", css: "saturate(1.12) hue-rotate(-8deg) brightness(1.03) contrast(1.02)" },
  { id: "bw", name: "B&W", css: "grayscale(1) contrast(1.06) brightness(1.02)" },
  { id: "vintage", name: "Vintage", css: "sepia(0.5) contrast(1.1) brightness(0.98) saturate(0.85)" },
];

export const DEFAULT_FILTER_ID = "soft";

export function getFilter(idOrNull: string | undefined): FilterPreset {
  return FILTERS.find((f) => f.id === idOrNull) ?? FILTERS[0];
}
