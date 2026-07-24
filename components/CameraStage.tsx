"use client";

import { RefObject } from "react";
import { cn } from "@/lib/utils";

interface CameraStageProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Cell aspect (w/h) so the preview matches the final slot shape. */
  aspect: number;
  filterCss: string;
  mirror?: boolean;
  /** Big centred overlay text (countdown number or word); null hides it. */
  overlay?: string | null;
  /** White flash on shutter. */
  flash?: boolean;
  /** Dim + disable pointer while capturing. */
  dimmed?: boolean;
  children?: React.ReactNode;
}

export default function CameraStage({
  videoRef,
  aspect,
  filterCss,
  mirror = true,
  overlay,
  flash,
  dimmed,
  children,
}: CameraStageProps) {
  return (
    <div
      className="relative mx-auto w-full overflow-hidden rounded-2xl bg-black shadow-2xl shadow-black/50 ring-1 ring-white/10"
      style={{
        aspectRatio: String(aspect),
        maxHeight: "66vh",
        maxWidth: `calc(66vh * ${aspect})`,
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={cn("h-full w-full object-cover", dimmed && "brightness-75")}
        style={{
          transform: mirror ? "scaleX(-1)" : undefined,
          filter: filterCss && filterCss !== "none" ? filterCss : undefined,
        }}
      />

      {overlay != null && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="select-none text-[22vw] font-black leading-none text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.6)] sm:text-[160px] tabular-nums">
            {overlay}
          </span>
        </div>
      )}

      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-white transition-opacity duration-150",
          flash ? "opacity-90" : "opacity-0",
        )}
      />

      {children}
    </div>
  );
}
