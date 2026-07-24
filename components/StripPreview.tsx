"use client";

import { COMPOSE, computeLayout, LayoutDef } from "@/lib/layouts";
import { FrameStyle } from "@/lib/frames";

interface StripPreviewProps {
  layout: LayoutDef;
  style: FrameStyle;
  /** Ordered image URLs, one per slot; null renders a numbered placeholder. */
  frameUrls: Array<string | null>;
  /** CSS filter applied to the photos (chosen after capture). */
  filterCss: string;
  caption: string;
  dateStr: string;
  widthPx: number;
}

/**
 * DOM preview of the finished image. Uses the exact same geometry as the
 * canvas compositor (computeLayout) so on-screen === downloaded PNG.
 */
export default function StripPreview({
  layout,
  style,
  frameUrls,
  filterCss,
  caption,
  dateStr,
  widthPx,
}: StripPreviewProps) {
  const { slots, footer, canvas } = computeLayout(layout);
  const scale = widthPx / canvas.w;
  const heightPx = canvas.h * scale;
  const filter = filterCss && filterCss !== "none" ? filterCss : undefined;

  return (
    <div
      className="relative overflow-hidden rounded-[10px] shadow-2xl shadow-black/40 ring-1 ring-black/10"
      style={{ width: widthPx, height: heightPx, background: style.sheetBg }}
    >
      {slots.map((slot, i) => {
        const url = frameUrls[i] ?? null;
        return (
          <div
            key={i}
            className="absolute overflow-hidden"
            style={{
              left: slot.x * scale,
              top: slot.y * scale,
              width: slot.w * scale,
              height: slot.h * scale,
              borderRadius: COMPOSE.cornerRadius * scale,
            }}
          >
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={`Frame ${i + 1}`}
                className="h-full w-full object-cover"
                style={{ filter }}
                draggable={false}
              />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center border border-dashed"
                style={{
                  borderColor: `${style.textColor}55`,
                  color: `${style.textColor}88`,
                  fontSize: 14,
                }}
              >
                {i + 1}
              </div>
            )}
          </div>
        );
      })}

      <div
        className="absolute flex flex-col items-center justify-center"
        style={{
          left: footer.x * scale,
          top: footer.y * scale,
          width: footer.w * scale,
          height: footer.h * scale,
          color: style.textColor,
        }}
      >
        <span
          style={{
            fontWeight: 700,
            letterSpacing: 1,
            fontSize: Math.max(9, footer.h * 0.26 * scale),
          }}
        >
          {caption.toUpperCase()}
        </span>
        <span
          style={{
            opacity: 0.78,
            fontSize: Math.max(8, footer.h * 0.18 * scale),
            marginTop: 2,
          }}
        >
          {dateStr}
        </span>
      </div>
    </div>
  );
}
