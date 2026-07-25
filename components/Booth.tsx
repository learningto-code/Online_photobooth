"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useCamera, isInAppBrowser } from "@/lib/useCamera";
import { captureFrame, releaseCanvas } from "@/lib/capture";
import { composeSheet, ComposeResult } from "@/lib/composite";
import {
  captureSize,
  computeLayout,
  DEFAULT_LAYOUT_ID,
  EXTRA_SHOTS,
  getLayout,
  LAYOUTS,
  LayoutId,
} from "@/lib/layouts";
import { DEFAULT_FILTER_ID, FILTERS, getFilter } from "@/lib/filters";
import { DEFAULT_FRAME_ID, FRAMES, getFrame } from "@/lib/frames";
import { beep, shutter, unlockAudio } from "@/lib/sound";
import { cn, fileToImage, formatDate, id, sleep } from "@/lib/utils";
import CameraStage from "./CameraStage";
import StripPreview from "./StripPreview";

type Phase = "ready" | "capturing" | "review" | "result";

interface Frame {
  id: string;
  canvas: HTMLCanvasElement;
  url: string;
}

const COUNTDOWN_SECONDS = 3;

export default function Booth() {
  const { videoRef, status, error, start, stop } = useCamera();

  const [layoutId, setLayoutId] = useState<LayoutId>(DEFAULT_LAYOUT_ID);
  const [filterId, setFilterId] = useState(DEFAULT_FILTER_ID);
  const [frameId, setFrameId] = useState(DEFAULT_FRAME_ID);
  const [caption, setCaption] = useState("PHOTOBOOTH");

  const [phase, setPhase] = useState<Phase>("ready");
  const [count, setCount] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [shotNo, setShotNo] = useState(0);
  const [captured, setCaptured] = useState<Frame[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<ComposeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [inApp] = useState(() => isInAppBrowser());
  const [bgImage, setBgImage] = useState<ImageBitmap | null>(null);
  const [bgUrl, setBgUrl] = useState<string | null>(null);

  const dateStr = useMemo(() => formatDate(), []);
  const layout = getLayout(layoutId);
  const filter = getFilter(filterId);
  const frame = getFrame(frameId);
  const captureAspect = useMemo(() => computeLayout(layout).captureAspect, [layout]);
  const captureCount = layout.shots + EXTRA_SHOTS;

  // Refs for unmount cleanup (avoid stale closures).
  const capturedRef = useRef<Frame[]>([]);
  const resultRef = useRef<ComposeResult | null>(null);
  const bgUrlRef = useRef<string | null>(null);
  useEffect(() => {
    capturedRef.current = captured;
  }, [captured]);
  useEffect(() => {
    resultRef.current = result;
  }, [result]);
  useEffect(() => {
    bgUrlRef.current = bgUrl;
  }, [bgUrl]);

  const onBgUpload = useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      const { bitmap, url } = await fileToImage(file);
      setBgUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setBgImage(bitmap);
    } catch {
      /* ignore unreadable images */
    }
  }, []);

  const clearBg = useCallback(() => {
    setBgUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setBgImage(null);
  }, []);

  // Re-attach the stream whenever we return to the live view.
  useEffect(() => {
    if (phase === "ready" && status === "ready") void start();
  }, [phase, status, start]);

  useEffect(
    () => () => {
      capturedRef.current.forEach((f) => {
        URL.revokeObjectURL(f.url);
        releaseCanvas(f.canvas);
      });
      if (resultRef.current) URL.revokeObjectURL(resultRef.current.url);
      if (bgUrlRef.current) URL.revokeObjectURL(bgUrlRef.current);
      stop();
    },
    [stop],
  );

  const enableCamera = useCallback(() => {
    unlockAudio();
    void start();
  }, [start]);

  const runSequence = useCallback(async () => {
    const video = videoRef.current;
    if (!video || status !== "ready") return;
    unlockAudio();

    // Clear any previous run.
    setCaptured((prev) => {
      prev.forEach((f) => {
        URL.revokeObjectURL(f.url);
        releaseCanvas(f.canvas);
      });
      return [];
    });
    setSelected([]);
    setResult((r) => {
      if (r) URL.revokeObjectURL(r.url);
      return null;
    });
    setPhase("capturing");

    const size = captureSize(captureAspect);
    const frames: Frame[] = [];

    for (let i = 0; i < captureCount; i++) {
      setShotNo(i + 1);
      for (let n = COUNTDOWN_SECONDS; n > 0; n--) {
        setCount(String(n));
        beep(n === 1);
        await sleep(1000);
      }
      setCount(null);
      setFlash(true);
      shutter();

      const canvas = captureFrame(video, size.w, size.h, true);
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob((b) => res(b), "image/jpeg", 0.9),
      );
      const url = blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/jpeg", 0.9);
      const f: Frame = { id: id(), canvas, url };
      frames.push(f);
      setCaptured([...frames]);

      await sleep(170);
      setFlash(false);
      await sleep(720);
    }

    setSelected(frames.slice(0, layout.shots).map((f) => f.id));
    setShotNo(0);
    setPhase("review");
  }, [videoRef, status, captureAspect, captureCount, layout.shots]);

  const toggleSelect = useCallback(
    (fid: string) => {
      setSelected((prev) => {
        if (prev.includes(fid)) return prev.filter((x) => x !== fid);
        if (prev.length >= layout.shots) return prev;
        return [...prev, fid];
      });
    },
    [layout.shots],
  );

  const createStrip = useCallback(async () => {
    if (selected.length !== layout.shots) return;
    setBusy(true);
    try {
      const byId = new Map(captured.map((f) => [f.id, f.canvas]));
      const frames = selected
        .map((sid) => byId.get(sid))
        .filter((c): c is HTMLCanvasElement => Boolean(c));
      const res = await composeSheet({
        frames,
        layout,
        style: frame,
        filterCss: filter.css,
        caption: caption.trim() || "PHOTOBOOTH",
        dateStr,
        bgImage,
      });
      setResult((r) => {
        if (r) URL.revokeObjectURL(r.url);
        return res;
      });
      setPhase("result");
    } finally {
      setBusy(false);
    }
  }, [selected, layout, captured, frame, filter.css, caption, dateStr, bgImage]);

  const backToBooth = useCallback(() => {
    setResult((r) => {
      if (r) URL.revokeObjectURL(r.url);
      return null;
    });
    setPhase("ready");
  }, []);

  const download = useCallback(() => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = result.url;
    a.download = `photobooth-${dateStr.replace(/\./g, "")}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [result, dateStr]);

  const share = useCallback(async () => {
    if (!result) return;
    const file = new File([result.blob], "photobooth.png", { type: "image/png" });
    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
    };
    if (nav.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Our photobooth" });
        return;
      } catch {
        /* user cancelled */
      }
    }
    download();
  }, [result, download]);

  const selectedUrls = useMemo(() => {
    const byId = new Map(captured.map((f) => [f.id, f.url]));
    return Array.from({ length: layout.shots }, (_, i) => {
      const sid = selected[i];
      return sid ? byId.get(sid) ?? null : null;
    });
  }, [captured, selected, layout.shots]);

  const liveView = phase === "ready" || phase === "capturing";

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-8">
      <header className="mb-5 flex items-center justify-between">
        <Link href="/" className="text-sm text-white/50 transition hover:text-white/80">
           Home
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">The Booth</h1>
        <div className="w-12" />
      </header>

      {inApp && (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          You&apos;re in an in-app browser that may block the camera. Tap the  menu and
          choose <span className="font-semibold">Open in Safari / Chrome</span>.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* LEFT - stage / preview */}
        <div className="min-w-0">
          {liveView && (
            <CameraStage
              videoRef={videoRef}
              aspect={captureAspect}
              filterCss="none"
              overlay={count}
              flash={flash}
              dimmed={phase === "capturing" && count == null}
            >
              {phase === "ready" && status !== "ready" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70 p-6 text-center">
                  {status === "error" ? (
                    <>
                      <p className="max-w-sm text-sm text-white/80">{error}</p>
                      <button onClick={enableCamera} className="btn-primary">
                        Try again
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="max-w-xs text-sm text-white/70">
                        We need your camera to take photos. Nothing is uploaded - everything
                        stays on your device.
                      </p>
                      <button
                        onClick={enableCamera}
                        disabled={status === "requesting"}
                        className="btn-primary"
                      >
                        {status === "requesting" ? "Starting" : "Enable camera"}
                      </button>
                    </>
                  )}
                </div>
              )}

              {phase === "capturing" && (
                <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white/90">
                  Shot {shotNo} of {captureCount}
                </div>
              )}
            </CameraStage>
          )}

          {phase === "review" && (
            <div className="flex flex-col items-center gap-4">
              <p className="text-sm text-white/60">
                Pick your favourite {layout.shots} - tap in the order you want them.
              </p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {captured.map((f) => {
                  const order = selected.indexOf(f.id);
                  const isSel = order >= 0;
                  return (
                    <button
                      key={f.id}
                      onClick={() => toggleSelect(f.id)}
                      className={cn(
                        "relative overflow-hidden rounded-lg ring-2 transition",
                        isSel ? "ring-pink-400" : "ring-transparent hover:ring-white/30",
                      )}
                      style={{ aspectRatio: String(captureAspect) }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={f.url} alt="" className="h-full w-full object-cover" />
                      {isSel && (
                        <span className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-pink-500 text-xs font-bold text-white shadow">
                          {order + 1}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {phase === "result" && result && (
            <div className="flex flex-col items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.url}
                alt="Your photo strip"
                className="max-h-[70vh] w-auto rounded-lg shadow-2xl shadow-black/50 ring-1 ring-white/10"
              />
            </div>
          )}
        </div>

        {/* RIGHT - controls */}
        <aside className="flex flex-col gap-5">
          {phase === "ready" && (
            <>
              <Section title="Format">
                <div className="grid gap-2">
                  {LAYOUTS.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => setLayoutId(l.id)}
                      className={cn(
                        "rounded-xl border px-3 py-2.5 text-left transition",
                        layoutId === l.id
                          ? "border-pink-400 bg-pink-400/10"
                          : "border-white/10 bg-white/5 hover:border-white/25",
                      )}
                    >
                      <div className="text-sm font-medium">{l.name}</div>
                      <div className="text-xs text-white/50">{l.description}</div>
                    </button>
                  ))}
                </div>
              </Section>

              <p className="text-xs text-white/45">
                Pick a format, strike a pose, then choose your filter &amp; frame after the
                shots.
              </p>

              <button
                onClick={runSequence}
                disabled={status !== "ready"}
                className="btn-primary w-full py-3 text-base"
              >
                Start  {captureCount} shots
              </button>
            </>
          )}

          {phase === "capturing" && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center text-sm text-white/60">
              Strike a pose! Capturing {captureCount} shots - you&apos;ll pick your favourites
              next.
            </div>
          )}

          {phase === "review" && (
            <>
              <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-black/30 p-4">
                <StripPreview
                  layout={layout}
                  style={frame}
                  frameUrls={selectedUrls}
                  filterCss={filter.css}
                  bgUrl={bgUrl}
                  caption={caption.trim() || "PHOTOBOOTH"}
                  dateStr={dateStr}
                  widthPx={layout.cols > 1 ? 220 : 150}
                />
              </div>

              <Section title="Filter">
                <ChipRow>
                  {FILTERS.map((f) => (
                    <Chip key={f.id} active={filterId === f.id} onClick={() => setFilterId(f.id)}>
                      {f.name}
                    </Chip>
                  ))}
                </ChipRow>
              </Section>

              <FrameControls
                frameId={frameId}
                setFrameId={setFrameId}
                caption={caption}
                setCaption={setCaption}
              />

              <Section title="Background photo">
                <div className="flex items-center gap-2">
                  <label className="btn-secondary cursor-pointer px-3 py-2 text-sm">
                    {bgUrl ? "Change" : "Upload"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => void onBgUpload(e.target.files?.[0])}
                    />
                  </label>
                  {bgUrl && (
                    <button onClick={clearBg} className="btn-ghost">
                      Remove
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs text-white/40">
                  Uses your image as the frame background (behind the photos).
                </p>
              </Section>

              <div className="flex flex-col gap-2">
                <button
                  onClick={createStrip}
                  disabled={selected.length !== layout.shots || busy}
                  className="btn-primary w-full py-3"
                >
                  {busy
                    ? "Creating"
                    : selected.length === layout.shots
                      ? "Create photo strip"
                      : `Select ${layout.shots - selected.length} more`}
                </button>
                <button onClick={() => setSelected([])} className="btn-ghost">
                  Clear selection
                </button>
                <button onClick={backToBooth} className="btn-ghost">
                  Retake all
                </button>
              </div>
            </>
          )}

          {phase === "result" && (
            <>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                Looking good! Download it or share it with your people.
              </div>
              <div className="flex flex-col gap-2">
                <button onClick={share} className="btn-primary w-full py-3">
                  Share
                </button>
                <button onClick={download} className="btn-secondary w-full py-3">
                  Download PNG
                </button>
                <button onClick={backToBooth} className="btn-ghost">
                  Start over
                </button>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">
        {title}
      </h2>
      {children}
    </div>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm transition",
        active
          ? "border-pink-400 bg-pink-400/15 text-white"
          : "border-white/10 bg-white/5 text-white/70 hover:border-white/25",
      )}
    >
      {children}
    </button>
  );
}

function FrameControls({
  frameId,
  setFrameId,
  caption,
  setCaption,
}: {
  frameId: string;
  setFrameId: (id: string) => void;
  caption: string;
  setCaption: (c: string) => void;
}) {
  return (
    <>
      <Section title="Frame">
        <div className="flex flex-wrap gap-2">
          {FRAMES.map((f) => (
            <button
              key={f.id}
              onClick={() => setFrameId(f.id)}
              title={f.name}
              className={cn(
                "h-9 w-9 rounded-full border-2 transition",
                frameId === f.id ? "border-pink-400 scale-110" : "border-white/20",
              )}
              style={{ background: f.swatch ?? f.sheetBg }}
            />
          ))}
        </div>
      </Section>

      <Section title="Caption">
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value.slice(0, 24))}
          placeholder="PHOTOBOOTH"
          className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-pink-400"
        />
      </Section>
    </>
  );
}
