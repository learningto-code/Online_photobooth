"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { Room } from "@/lib/room";
import {
  EVENT,
  getServerOffsetMs,
  PresenceMeta,
  roomChannel,
  RoomEvent,
  sendEvent,
} from "@/lib/realtime";
import { useCamera } from "@/lib/useCamera";
import { captureFrame } from "@/lib/capture";
import {
  composeSheetMulti,
  Drawable,
  subSlotAspect,
} from "@/lib/composite";
import {
  captureSize,
  computeLayout,
  getLayout,
  LAYOUTS,
  LayoutId,
} from "@/lib/layouts";
import { DEFAULT_FILTER_ID, FILTERS, getFilter } from "@/lib/filters";
import { DEFAULT_FRAME_ID, FRAMES, getFrame } from "@/lib/frames";
import { beep, shutter, unlockAudio } from "@/lib/sound";
import { cn, formatDate, id, sleep } from "@/lib/utils";
import CameraStage from "./CameraStage";
import { Chip, ChipRow, Section } from "./ui";

const COUNTDOWN_SECONDS = 3;
const LEAD_MS = 5000; // from now to the first shot
const SHOT_PAUSE_MS = 700;
const FLASH_MS = 170;
const CAPTURE_WINDOW_MS = 40000; // host safety timeout to composite whatever arrived

type Phase = "lobby" | "capturing" | "processing" | "result";

interface Props {
  room: Room;
  userId: string;
  name: string;
  isHost: boolean;
}

export default function RoomBooth({ room, userId, name, isHost }: Props) {
  const { videoRef, status: camStatus, error: camError, start: startCamera } = useCamera();

  const [displayName, setDisplayName] = useState(name);
  const [ready, setReady] = useState(false);
  const [presence, setPresence] = useState<Record<string, PresenceMeta>>({});
  const [subscribed, setSubscribed] = useState(false);

  // Session config (host picks; broadcast to all).
  const [layoutId, setLayoutId] = useState<LayoutId>(room.layout as LayoutId);
  const [filterId, setFilterId] = useState(DEFAULT_FILTER_ID);
  const [frameId, setFrameId] = useState(DEFAULT_FRAME_ID);
  const [caption, setCaption] = useState(room.name?.trim() || "PHOTOBOOTH");

  const [phase, setPhase] = useState<Phase>("lobby");
  const [session, setSession] = useState<Extract<RoomEvent, { type: "session_start" }> | null>(
    null,
  );
  const [count, setCount] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [shotNo, setShotNo] = useState(0);
  const [result, setResult] = useState<{ url: string | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const offsetRef = useRef(0);
  const handlerRef = useRef<(e: RoomEvent) => void>(() => {});
  const receivedRef = useRef<Map<string, RoomEvent & { type: "frame_uploaded" }>>(new Map());
  const builtRef = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef<Extract<RoomEvent, { type: "session_start" }> | null>(null);

  const cameraReady = camStatus === "ready";
  const dateStr = useMemo(() => formatDate(), []);

  const participants = useMemo(() => Object.values(presence), [presence]);
  const readyIds = useMemo(
    () => participants.filter((p) => p.ready).map((p) => p.userId).sort(),
    [participants],
  );

  const layout = getLayout(session?.layoutId ?? layoutId);
  const previewParticipants =
    phase === "capturing" && session
      ? session.order.length
      : Math.max(1, readyIds.length || participants.length || 1);

  const previewAspect = useMemo(() => {
    const slot0 = computeLayout(layout).slots[0];
    return subSlotAspect(slot0.w, slot0.h, previewParticipants);
  }, [layout, previewParticipants]);

  const activeFilterCss = getFilter(session?.filterId ?? filterId).css;

  // ---- Realtime channel setup -------------------------------------------
  useEffect(() => {
    const ch = roomChannel(room.id, userId);
    channelRef.current = ch;

    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<PresenceMeta>();
      const map: Record<string, PresenceMeta> = {};
      for (const key of Object.keys(state)) {
        const metas = state[key];
        if (metas && metas[0]) {
          map[key] = {
            userId: metas[0].userId,
            name: metas[0].name,
            ready: metas[0].ready,
            isHost: metas[0].isHost,
          };
        }
      }
      setPresence(map);
    });

    ch.on("broadcast", { event: EVENT }, ({ payload }) =>
      handlerRef.current(payload as RoomEvent),
    );

    ch.subscribe(async (statusStr) => {
      if (statusStr === "SUBSCRIBED") {
        await ch.track({ userId, name: displayName, ready: false, isHost });
        setSubscribed(true);
        offsetRef.current = await getServerOffsetMs();
      }
    });

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      void ch.unsubscribe();
      getSupabase().removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id, userId]);

  // Re-broadcast presence when our meta changes.
  useEffect(() => {
    if (subscribed && channelRef.current) {
      void channelRef.current.track({ userId, name: displayName, ready, isHost });
    }
  }, [subscribed, displayName, ready, isHost, userId]);

  // ---- Capture sequence (runs on every device) --------------------------
  const runCapture = useCallback(
    async (ses: Extract<RoomEvent, { type: "session_start" }>) => {
      const video = videoRef.current;
      const partCount = ses.order.length;
      const myTurn = ses.order.includes(userId);
      if (!video || camStatus !== "ready" || !myTurn) {
        // Not participating (no camera / not ready): just wait for the strip.
        setPhase("processing");
        return;
      }
      unlockAudio();

      const lay = getLayout(ses.layoutId);
      const slot0 = computeLayout(lay).slots[0];
      const aspect = subSlotAspect(slot0.w, slot0.h, partCount);
      const size = captureSize(aspect);

      // Anchor the first countdown to the shared shoot instant.
      const startLocal = ses.shootAt - COUNTDOWN_SECONDS * 1000 - offsetRef.current;
      const wait = startLocal - Date.now();
      if (wait > 0) await sleep(wait);

      const frames: HTMLCanvasElement[] = [];
      for (let i = 0; i < ses.frameCount; i++) {
        setShotNo(i + 1);
        for (let n = COUNTDOWN_SECONDS; n > 0; n--) {
          setCount(String(n));
          beep(n === 1);
          await sleep(1000);
        }
        setCount(null);
        setFlash(true);
        shutter();
        frames.push(captureFrame(video, size.w, size.h, true));
        await sleep(FLASH_MS);
        setFlash(false);
        await sleep(SHOT_PAUSE_MS);
      }

      setShotNo(0);
      setPhase("processing");

      // Upload my frames, then announce each path.
      const ch = channelRef.current;
      await Promise.all(
        frames.map(async (canvas, i) => {
          const blob = await new Promise<Blob | null>((res) =>
            canvas.toBlob((b) => res(b), "image/jpeg", 0.9),
          );
          if (!blob) return;
          const path = `${room.id}/${ses.sessionId}/${userId}-${i}.jpg`;
          const { error } = await getSupabase()
            .storage.from("captures")
            .upload(path, blob, { contentType: "image/jpeg", upsert: true });
          if (error) return;
          if (ch) sendEvent(ch, { type: "frame_uploaded", sessionId: ses.sessionId, userId, frameIndex: i, path });
        }),
      );
    },
    [videoRef, camStatus, userId, room.id],
  );

  // ---- Host: build the final strip once all frames are in ---------------
  const buildStripOnce = useCallback(
    async (ses: Extract<RoomEvent, { type: "session_start" }>) => {
      if (!isHost) return;
      if (builtRef.current === ses.sessionId) return;
      builtRef.current = ses.sessionId;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      const sb = getSupabase();
      const lay = getLayout(ses.layoutId);

      const cache = new Map<string, Drawable | null>();
      const load = async (path: string): Promise<Drawable | null> => {
        if (cache.has(path)) return cache.get(path) ?? null;
        const { data } = await sb.storage.from("captures").download(path);
        let bmp: Drawable | null = null;
        if (data) {
          try {
            bmp = await createImageBitmap(data);
          } catch {
            bmp = null;
          }
        }
        cache.set(path, bmp);
        return bmp;
      };

      const slots: Array<Array<Drawable | null>> = [];
      for (let i = 0; i < ses.shots; i++) {
        const row: Array<Drawable | null> = [];
        for (const uid of ses.order) {
          const rec = receivedRef.current.get(`${uid}:${i}`);
          row.push(rec ? await load(rec.path) : null);
        }
        slots.push(row);
      }

      const res = await composeSheetMulti({
        slots,
        layout: lay,
        style: getFrame(ses.frameId),
        filterCss: getFilter(ses.filterId).css,
        caption: ses.caption || "PHOTOBOOTH",
        dateStr,
      });

      const stripPath = `${room.id}/${ses.sessionId}.png`;
      await sb.storage.from("strips").upload(stripPath, res.blob, {
        contentType: "image/png",
        upsert: true,
      });
      await sb
        .from("strips")
        .insert({ room_id: room.id, session_id: ses.sessionId, storage_path: stripPath, created_by: userId });

      URL.revokeObjectURL(res.url);
      const ch = channelRef.current;
      if (ch) sendEvent(ch, { type: "strip_ready", sessionId: ses.sessionId, path: stripPath });
    },
    [isHost, room.id, userId, dateStr],
  );

  const onStripReady = useCallback(async (path: string) => {
    const sb = getSupabase();
    const { data } = await sb.storage.from("strips").createSignedUrl(path, 60 * 60 * 24 * 7);
    setResult({ url: data?.signedUrl ?? null });
    setPhase("result");
  }, []);

  // ---- Event router -----------------------------------------------------
  const handleEvent = useCallback(
    (e: RoomEvent) => {
      switch (e.type) {
        case "session_start": {
          receivedRef.current = new Map();
          builtRef.current = null;
          sessionRef.current = e;
          setResult(null);
          setSession(e);
          setPhase("capturing");
          void runCapture(e);
          if (isHost) {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(() => void buildStripOnce(e), CAPTURE_WINDOW_MS);
          }
          break;
        }
        case "frame_uploaded": {
          if (!isHost) return;
          receivedRef.current.set(`${e.userId}:${e.frameIndex}`, e);
          const ses = sessionRef.current;
          if (ses) {
            const expected = ses.order.length * ses.shots;
            if (receivedRef.current.size >= expected) void buildStripOnce(ses);
          }
          break;
        }
        case "strip_ready":
          void onStripReady(e.path);
          break;
        case "session_cancel":
          setSession(null);
          setPhase("lobby");
          break;
      }
    },
    [isHost, runCapture, buildStripOnce, onStripReady],
  );

  // Keep the latest session available to the (host) frame_uploaded handler.
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    handlerRef.current = handleEvent;
  }, [handleEvent]);

  // ---- Host: start a synchronized session -------------------------------
  const startSession = useCallback(() => {
    const ch = channelRef.current;
    if (!ch) return;
    const order = readyIds;
    if (order.length === 0) {
      setNotice("Everyone needs to tap Ready first.");
      return;
    }
    const lay = getLayout(layoutId);
    const sessionId = id();
    const shootAt = Date.now() + offsetRef.current + LEAD_MS;
    const evt: Extract<RoomEvent, { type: "session_start" }> = {
      type: "session_start",
      sessionId,
      shootAt,
      order,
      shots: lay.shots,
      frameCount: lay.shots,
      layoutId,
      filterId,
      frameId,
      caption: caption.trim() || "PHOTOBOOTH",
    };
    sendEvent(ch, evt);
    // Best-effort durability (not on the critical path).
    void getSupabase()
      .from("sessions")
      .insert({
        id: sessionId,
        room_id: room.id,
        started_by: userId,
        shoot_at: shootAt,
        layout: layoutId,
        filter_id: filterId,
        frame_id: frameId,
        caption: caption.trim() || "PHOTOBOOTH",
        shots: lay.shots,
        frame_count: lay.shots,
        participant_order: order,
        status: "shooting",
      });
  }, [readyIds, layoutId, filterId, frameId, caption, room.id, userId]);

  const backToLobby = useCallback(() => {
    setResult(null);
    setSession(null);
    setPhase("lobby");
  }, []);

  const inviteUrl = typeof window !== "undefined" ? `${window.location.origin}/room/${room.code}` : "";

  const download = useCallback(async () => {
    if (!result?.url) return;
    const blob = await (await fetch(result.url)).blob();
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = `photobooth-${dateStr.replace(/\./g, "")}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(u);
  }, [result, dateStr]);

  const share = useCallback(async () => {
    if (!result?.url) return;
    const blob = await (await fetch(result.url)).blob();
    const file = new File([blob], "photobooth.png", { type: "image/png" });
    const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Our photobooth" });
        return;
      } catch {
        /* cancelled */
      }
    }
    void download();
  }, [result, download]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-8">
      <header className="mb-5 flex items-center justify-between">
        <Link href="/" className="text-sm text-white/50 transition hover:text-white/80">
          ← Home
        </Link>
        <h1 className="text-lg font-semibold tracking-tight">
          Room <span className="font-mono text-pink-300">{room.code}</span>
        </h1>
        <div className="w-12" />
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* LEFT — self view / result */}
        <div className="min-w-0">
          {phase === "result" && result ? (
            <div className="flex flex-col items-center">
              {result.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={result.url}
                  alt="Your photo strip"
                  className="max-h-[70vh] w-auto rounded-lg shadow-2xl shadow-black/50 ring-1 ring-white/10"
                />
              ) : (
                <p className="text-white/60">Couldn&apos;t load the strip.</p>
              )}
            </div>
          ) : phase === "processing" ? (
            <div className="flex aspect-square w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/60">
              Developing your photos…
            </div>
          ) : (
            <CameraStage
              videoRef={videoRef}
              aspect={previewAspect}
              filterCss={activeFilterCss}
              overlay={count}
              flash={flash}
              dimmed={phase === "capturing" && count == null}
            >
              {phase === "lobby" && !cameraReady && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70 p-6 text-center">
                  {camStatus === "error" ? (
                    <>
                      <p className="max-w-sm text-sm text-white/80">{camError}</p>
                      <button onClick={() => void startCamera()} className="btn-primary">
                        Try again
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="max-w-xs text-sm text-white/70">
                        Turn on your camera to join the shoot. It stays on your device.
                      </p>
                      <button
                        onClick={() => {
                          unlockAudio();
                          void startCamera();
                        }}
                        disabled={camStatus === "requesting"}
                        className="btn-primary"
                      >
                        {camStatus === "requesting" ? "Starting…" : "Enable camera"}
                      </button>
                    </>
                  )}
                </div>
              )}
              {phase === "capturing" && session && (
                <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-xs font-medium text-white/90">
                  Shot {shotNo} of {session.frameCount}
                </div>
              )}
            </CameraStage>
          )}
        </div>

        {/* RIGHT — lobby / result controls */}
        <aside className="flex flex-col gap-5">
          {phase === "lobby" && (
            <>
              <Section title="You">
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value.slice(0, 20))}
                  className="mb-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-pink-400"
                />
                <button
                  onClick={() => setReady((r) => !r)}
                  disabled={!cameraReady}
                  className={cn("w-full", ready ? "btn-secondary" : "btn-primary")}
                >
                  {ready ? "✓ Ready" : cameraReady ? "I'm ready" : "Enable camera first"}
                </button>
              </Section>

              <Section title={`In the room (${participants.length})`}>
                <ul className="flex flex-col gap-1.5">
                  {participants.map((p) => (
                    <li
                      key={p.userId}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
                    >
                      <span className="truncate">
                        {p.name}
                        {p.isHost && <span className="ml-1 text-xs text-white/40">host</span>}
                        {p.userId === userId && <span className="ml-1 text-xs text-white/40">you</span>}
                      </span>
                      <span className={cn("text-xs", p.ready ? "text-emerald-400" : "text-white/40")}>
                        {p.ready ? "ready" : "waiting"}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>

              {isHost ? (
                <>
                  <Section title="Format">
                    <div className="grid gap-2">
                      {LAYOUTS.map((l) => (
                        <button
                          key={l.id}
                          onClick={() => setLayoutId(l.id)}
                          className={cn(
                            "rounded-xl border px-3 py-2 text-left text-sm transition",
                            layoutId === l.id
                              ? "border-pink-400 bg-pink-400/10"
                              : "border-white/10 bg-white/5 hover:border-white/25",
                          )}
                        >
                          {l.name}
                        </button>
                      ))}
                    </div>
                  </Section>
                  <Section title="Filter">
                    <ChipRow>
                      {FILTERS.map((f) => (
                        <Chip key={f.id} active={filterId === f.id} onClick={() => setFilterId(f.id)}>
                          {f.name}
                        </Chip>
                      ))}
                    </ChipRow>
                  </Section>
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
                  {notice && <p className="text-xs text-amber-300">{notice}</p>}
                  <button onClick={startSession} disabled={readyIds.length === 0} className="btn-primary w-full py-3">
                    Start shoot · {readyIds.length} ready
                  </button>
                </>
              ) : (
                <p className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                  Waiting for the host to start the shoot. Tap <b>Ready</b> when your camera&apos;s on.
                </p>
              )}

              <Section title="Invite">
                <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                  {inviteUrl && (
                    <div className="rounded bg-white p-1.5">
                      <QRCodeSVG value={inviteUrl} size={72} />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-xs text-white/50">{inviteUrl}</p>
                    <button
                      onClick={() => void navigator.clipboard?.writeText(inviteUrl)}
                      className="btn-ghost mt-1 px-0"
                    >
                      Copy link
                    </button>
                  </div>
                </div>
              </Section>
            </>
          )}

          {phase === "capturing" && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center text-sm text-white/60">
              Everyone smile — shooting together! ✨
            </div>
          )}

          {phase === "result" && (
            <>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                Here you are, together. Download or share it.
              </div>
              <div className="flex flex-col gap-2">
                <button onClick={() => void share()} className="btn-primary w-full py-3">
                  Share
                </button>
                <button onClick={() => void download()} className="btn-secondary w-full py-3">
                  Download PNG
                </button>
                {result?.url && (
                  <div className="mt-1 flex flex-col items-center gap-1 rounded-2xl border border-white/10 bg-white/5 p-3">
                    <div className="rounded bg-white p-1.5">
                      <QRCodeSVG value={result.url} size={96} />
                    </div>
                    <p className="text-xs text-white/50">Scan to save on your phone</p>
                  </div>
                )}
                <button onClick={backToLobby} className="btn-ghost">
                  Back to lobby
                </button>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
