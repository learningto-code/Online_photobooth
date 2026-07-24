"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CameraStatus = "idle" | "requesting" | "ready" | "error";

function describeError(err: unknown): string {
  const name = (err as { name?: string })?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access was blocked. Allow camera permission in your browser and try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found on this device.";
    case "NotReadableError":
      return "Your camera is already in use by another app. Close it and try again.";
    default:
      return "Could not start the camera. Make sure you're on HTTPS and not inside an in-app browser (Instagram/Facebook) — open in Safari or Chrome.";
  }
}

/** Detect in-app webviews that commonly block getUserMedia. */
export function isInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /FBAN|FBAV|Instagram|Line|KAKAOTALK|Twitter|Snapchat/i.test(ua);
}

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const attach = useCallback(() => {
    const v = videoRef.current;
    if (v && streamRef.current) {
      if (v.srcObject !== streamRef.current) v.srcObject = streamRef.current;
      v.muted = true;
      v.playsInline = true;
      void v.play().catch(() => {});
    }
  }, []);

  const start = useCallback(async () => {
    // Already have a stream — just (re)attach it to the current <video>
    // (e.g. after the element remounted on retake).
    if (streamRef.current) {
      attach();
      setStatus("ready");
      return;
    }
    setStatus("requesting");
    setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException("getUserMedia unavailable", "NotFoundError");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      attach();
      setStatus("ready");
    } catch (err) {
      setError(describeError(err));
      setStatus("error");
    }
  }, [attach]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Always stop tracks on unmount so the camera light turns off.
  useEffect(() => () => stop(), [stop]);

  return { videoRef, status, error, start, stop };
}
