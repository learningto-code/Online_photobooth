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
import { composeSheetMulti, Drawable, subSlotAspect } from "@/lib/composite";
import { captureSize, computeLayout, getLayout, LAYOUTS, LayoutId } from "@/lib/layouts";
import { DEFAULT_FILTER_ID, FILTERS, getFilter } from "@/lib/filters";
import { DEFAULT_FRAME_ID, FRAMES, getFrame } from "@/lib/frames";
import { beep, shutter, unlockAudio } from "@/lib/sound";
import { cn, fileToImage, formatDate, id, sleep } from "@/lib/utils";
import CameraStage from "./CameraStage";
import { Chip, ChipRow, Section } from "./ui";

const COUNTDOWN_SECONDS = 3;
const LEAD_MS = 5000; // now → first shot
const SHOT_PAUSE_MS = 700;
const FLASH_MS = 170;
const COLLECT_TIMEOUT_MS = 45000; // backstop: compose with whatever arrived

type Phase = "lobby" | "capturing" | "processing" | "styling" | "result";
type SessionStart = Extract<RoomEvent, { type: "session_start" }>;

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

  // Format is synced pre-capture; filter/frame/caption/bg are chosen AFTER capture (host styling).
  const [layoutId, setLayoutId] = useState<LayoutId>(room.layout as LayoutId);
  const [filterId, setFilterId] = useState(DEFAULT_FILTER_ID);
  const [frameId, setFrameId] = useState(DEFAULT_FRAME_ID);
  const [caption, setCaption] = useState(room.name?.trim() || "PHOTOBOOTH");
  const [bgImage, setBgImage] = useState<ImageBitmap | null>(null);
  const [bgUrl, setBgUrl] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("lobby");
  const [session, setSession] = useState<SessionStart | null>(null);
  const [count, setCount] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [shotNo, setShotNo] = useState(0);
  const [result, setResult] = useState<{ url: string | null } | null>(null);
  const [styleUrl, setStyleUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const offsetRef = useRef(0);
  const handlerRef = useRef<(e: RoomEvent) => void>(() => {});
  const sessionRef = useRef<SessionStart | null>(null);
  const receivedRef = useRef<Map<string, string>>(new Map()); // `${uid}:${i}` -> storage path
  const hostOwnFramesRef = useRef<HTMLCanvasElement[]>([]);
  const hostDoneRef = useRef<string | null>(null); // sessionId whose host-capture finished
  const stylingSlotsRef = useRef<Array<Array<Drawable | null>>>([]);
  const collectedRef = useRef<string | null>(null);
  const builtRef = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stripBlobRef = useRef<Blob | null>(null);
  const styleUrlRef = useRef<string | null>(null);
  const bgUrlRef = useRef<string | null>(null);
  const resultUrlRef = useRef<string | null>(null);

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

  useEffect(() => {
    styleUrlRef.current = styleUrl;
  }, [styleUrl]);
  useEffect(() => {
    bgUrlRef.current = bgUrl;
  }, [bgUrl]);
  useEffect(() => {
    resultUrlRef.current = result?.url ?? null;
  }, [result]);

  // ---- Realtime channel setup -------------------------------------------
  useEffect(() => {
    const ch = roomChannel(room.id, userId);
    channelRef.current = ch;

    const syncPresence = () => {
      const state = ch.presenceState<PresenceMeta>();
      const map: Record<string, PresenceMeta> = {};
      for (const key of Object.keys(state)) {
        const m = state[key]?.[0];
        if (m) map[key] = { userId: m.userId, name: m.name, ready: m.ready, isHost: m.isHost };
      }
      setPresence(map);
    };

    ch.on("presence", { event: "sync" }, syncPresence);
    ch.on("presence", { event: "join" }, syncPresence);
    ch.on("presence", { event: "leave" }, syncPresence);
    ch.on("broadcast", { event: EVENT }, ({ payload }) => handlerRef.current(payload as RoomEvent));

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
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id, userId]);

  // Re-broadcast our presence when name/ready changes.
  useEffect(() => {
    if (subscribed && channelRef.current) {
      void channelRef.current.track({ userId, name: displayName, ready, isHost });
    }
  }, [subscribed, displayName, ready, isHost, userId]);

  // Host pushes format to guests (on change + whenever someone joins).
  useEffect(() => {
    if (isHost && subscribed && channelRef.current) {
      sendEvent(channelRef.current, { type: "config", layoutId, caption });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, subscribed, layoutId, participants.length]);

  // ---- Background upload (host styling) ---------------------------------
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
      /* ignore */
    }
  }, []);
  const clearBg = useCallback(() => {
    setBgUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setBgImage(null);
  }, []);

  // ---- Host: assemble frames then move to the styling step --------------
  const loadFrame = useCallback(async (path: string): Promise<Drawable | null> => {
    try {
      const { data } = await getSupabase().storage.from("captures").download(path);
      if (!data) return null;
      return await createImageBitmap(data);
    } catch {
      return null;
    }
  }, []);

  const collectAndStyle = useCallback(
    async (ses: SessionStart) => {
      if (!isHost) return;
      if (collectedRef.current === ses.sessionId) return;
      collectedRef.current = ses.sessionId;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      const slots: Array<Array<Drawable | null>> = [];
      for (let i = 0; i < ses.shots; i++) {
        const row: Array<Drawable | null> = [];
        for (const uid of ses.order) {
          if (uid === userId && hostOwnFramesRef.current[i]) {
            row.push(hostOwnFramesRef.current[i]);
          } else {
            const path = receivedRef.current.get(`${uid}:${i}`);
            row.push(path ? await loadFrame(path) : null);
          }
        }
        slots.push(row);
      }
      stylingSlotsRef.current = slots;
      setPhase("styling");
    },
    [isHost, userId, loadFrame],
  );

  const tryCollect = useCallback(
    (ses: SessionStart | null) => {
      if (!ses || !isHost) return;
      if (collectedRef.current === ses.sessionId) return;
      // Wait for the host's own capture (if the host is a participant).
      if (ses.order.includes(userId) && hostDoneRef.current !== ses.sessionId) return;
      const needed = ses.order.filter((u) => u !== userId);
      const complete = needed.every((u) => {
        for (let i = 0; i < ses.shots; i++) if (!receivedRef.current.has(`${u}:${i}`)) return false;
        return true;
      });
      if (complete) void collectAndStyle(ses);
    },
    [isHost, userId, collectAndStyle],
  );

  // ---- Capture sequence (runs on every device) --------------------------
  const runCapture = useCallback(
    async (ses: SessionStart) => {
      const video = videoRef.current;
      const myTurn = ses.order.includes(userId);
      if (!video || camStatus !== "ready" || !myTurn) {
        setPhase("processing");
        if (isHost) {
          hostDoneRef.current = ses.sessionId; // host not shooting → don't block collection
          tryCollect(ses);
        }
        return;
      }
      unlockAudio();

      const slot0 = computeLayout(getLayout(ses.layoutId)).slots[0];
      const size = captureSize(subSlotAspect(slot0.w, slot0.h, ses.order.length));

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

      if (isHost) {
        hostOwnFramesRef.current = frames;
        hostDoneRef.current = ses.sessionId;
      }

      // Upload frames + announce paths (guests need these; host also persists its own).
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
          if (!isHost && ch) {
            sendEvent(ch, { type: "frame_uploaded", sessionId: ses.sessionId, userId, frameIndex: i, path });
          }
        }),
      );

      if (isHost) tryCollect(ses);
    },
    [videoRef, camStatus, userId, room.id, isHost, tryCollect],
  );

  const onStripReady = useCallback(async (path: string) => {
    const { data } = await getSupabase()
      .storage.from("strips")
      .createSignedUrl(path, 60 * 60 * 24 * 7);
    setResult({ url: data?.signedUrl ?? null });
    setPhase("result");
  }, []);

  // ---- Event router -----------------------------------------------------
  const handleEvent = useCallback(
    (e: RoomEvent) => {
      switch (e.type) {
        case "config":
          if (!isHost) {
            setLayoutId(e.layoutId as LayoutId);
          }
          break;
        case "session_start": {
          receivedRef.current = new Map();
          hostOwnFramesRef.current = [];
          hostDoneRef.current = null;
          stylingSlotsRef.current = [];
          collectedRef.current = null;
          builtRef.current = null;
          stripBlobRef.current = null;
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          sessionRef.current = e;
          setResult(null);
          setSession(e);
          setPhase("capturing");
          void runCapture(e);
          if (isHost) {
            timeoutRef.current = setTimeout(() => void collectAndStyle(e), COLLECT_TIMEOUT_MS);
          }
          break;
        }
        case "frame_uploaded": {
          if (!isHost || e.userId === userId) return;
          receivedRef.current.set(`${e.userId}:${e.frameIndex}`, e.path);
          tryCollect(sessionRef.current);
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
    [isHost, userId, runCapture, collectAndStyle, tryCollect, onStripReady],
  );

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  useEffect(() => {
    handlerRef.current = handleEvent;
  }, [handleEvent]);

  // ---- Host styling: live-compose a preview on every style change -------
  useEffect(() => {
    if (phase !== "styling") return;
    let cancelled = false;
    void (async () => {
      const res = await composeSheetMulti({
        slots: stylingSlotsRef.current,
        layout: getLayout(layoutId),
        style: getFrame(frameId),
        filterCss: getFilter(filterId).css,
        caption: caption.trim() || "PHOTOBOOTH",
        dateStr,
        bgImage,
      });
      if (cancelled) {
        URL.revokeObjectURL(res.url);
        return;
      }
      stripBlobRef.current = res.blob;
      setStyleUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return res.url;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, layoutId, filterId, frameId, caption, bgImage, dateStr]);

  const finalizeStrip = useCallback(async () => {
    const ses = sessionRef.current;
    const ch = channelRef.current;
    if (!ses || !ch || builtRef.current === ses.sessionId) return;
    setBusy(true);
    try {
      let blob = stripBlobRef.current;
      if (!blob) {
        const res = await composeSheetMulti({
          slots: stylingSlotsRef.current,
          layout: getLayout(layoutId),
          style: getFrame(frameId),
          filterCss: getFilter(filterId).css,
          caption: caption.trim() || "PHOTOBOOTH",
          dateStr,
          bgImage,
        });
        blob = res.blob;
        URL.revokeObjectURL(res.url);
      }
      const path = `${room.id}/${ses.sessionId}.png`;
      await getSupabase()
        .storage.from("strips")
        .upload(path, blob, { contentType: "image/png", upsert: true });
      await getSupabase()
        .from("strips")
        .insert({ room_id: room.id, session_id: ses.sessionId, storage_path: path, created_by: userId });
      builtRef.current = ses.sessionId;
      sendEvent(ch, { type: "strip_ready", sessionId: ses.sessionId, path });
    } finally {
      setBusy(false);
    }
  }, [layoutId, frameId, filterId, caption, bgImage, dateStr, room.id, userId]);

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
    const evt: SessionStart = {
      type: "session_start",
      sessionId: id(),
      shootAt: Date.now() + offsetRef.current + LEAD_MS,
      order,
      shots: lay.shots,
      frameCount: lay.shots,
      layoutId,
    };
    sendEvent(ch, evt);
    void getSupabase()
      .from("sessions")
      .insert({
        id: evt.sessionId,
        room_id: room.id,
        started_by: userId,
        shoot_at: evt.shootAt,
        layout: layoutId,
        shots: lay.shots,
        frame_count: lay.shots,
        participant_order: order,
        status: "shooting",
      });
  }, [readyIds, layoutId, room.id, userId]);

  const backToLobby = useCallback(() => {
    setResult(null);
    setStyleUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setSession(null);
    setPhase("lobby");
  }, []);

  const inviteUrl = typeof window !== "undefined" ? `${window.location.origin}/room/${room.code}` : "";

  // ---- Cleanup ----------------------------------------------------------
  useEffect(
    () => () => {
      if (styleUrlRef.current) URL.revokeObjectURL(styleUrlRef.current);
      if (bgUrlRef.current) URL.revokeObjectURL(bgUrlRef.current);
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    },
    [],
  );

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
        {/* LEFT — self view / preview / result */}
        <div className="flex min-w-0 flex-col gap-4">
          {phase === "result" && result ? (
            result.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={result.url}
                alt="Your photo strip"
                className="mx-auto max-h-[70vh] w-auto rounded-lg shadow-2xl shadow-black/50 ring-1 ring-white/10"
              />
            ) : (
              <p className="text-center text-white/60">Couldn&apos;t load the strip.</p>
            )
          ) : phase === "styling" && isHost ? (
            styleUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={styleUrl}
                alt="Style preview"
                className="mx-auto max-h-[70vh] w-auto rounded-lg shadow-2xl shadow-black/50 ring-1 ring-white/10"
              />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/60">
                Preparing your photos…
              </div>
            )
          ) : phase === "processing" || phase === "styling" ? (
            <div className="flex aspect-square w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-6 text-center text-white/60">
              {phase === "styling"
                ? "The host is choosing the style — hang tight ✨"
                : "Got your shots! Developing the photo…"}
            </div>
          ) : (
            <CameraStage
              videoRef={videoRef}
              aspect={previewAspect}
              filterCss="none"
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

          {/* Invite (under the preview) */}
          {phase === "lobby" && inviteUrl && (
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="rounded bg-white p-1.5">
                <QRCodeSVG value={inviteUrl} size={72} />
              </div>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-white/40">Invite a friend</p>
                <p className="truncate text-xs text-white/60">{inviteUrl}</p>
                <button
                  onClick={() => void navigator.clipboard?.writeText(inviteUrl)}
                  className="btn-ghost mt-1 px-0"
                >
                  Copy link
                </button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — controls */}
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
                  <p className="text-xs text-white/45">
                    Filters, frames &amp; a custom background come after the shots.
                  </p>
                  {notice && <p className="text-xs text-amber-300">{notice}</p>}
                  <button
                    onClick={startSession}
                    disabled={readyIds.length === 0}
                    className="btn-primary w-full py-3"
                  >
                    Start shoot · {readyIds.length} ready
                  </button>
                </>
              ) : (
                <p className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/60">
                  Format: <b>{layout.name}</b>. Tap <b>Ready</b> when your camera&apos;s on — the
                  host starts the shoot.
                </p>
              )}
            </>
          )}

          {phase === "capturing" && (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center text-sm text-white/60">
              Everyone smile — shooting together! ✨
            </div>
          )}

          {phase === "styling" && isHost && (
            <>
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
              </Section>
              <Section title="Caption">
                <input
                  value={caption}
                  onChange={(e) => setCaption(e.target.value.slice(0, 24))}
                  placeholder="PHOTOBOOTH"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-pink-400"
                />
              </Section>
              <button onClick={() => void finalizeStrip()} disabled={busy} className="btn-primary w-full py-3">
                {busy ? "Creating…" : "Finish photo"}
              </button>
            </>
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
                {isHost && (
                  <button onClick={backToLobby} className="btn-ghost">
                    Back to lobby
                  </button>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
