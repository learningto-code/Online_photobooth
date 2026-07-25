import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";

/** Presence payload each client tracks on the room channel. */
export interface PresenceMeta {
  userId: string;
  name: string;
  ready: boolean;
  isHost: boolean;
}

/** Ephemeral broadcast events (never carry image bytes — paths only). */
export type RoomEvent =
  // Lobby membership + ready state (broadcast is reliable; presence updates are not).
  | { type: "meta"; userId: string; name: string; ready: boolean; isHost: boolean }
  // A newly-joined client asks everyone to re-announce their meta.
  | { type: "sync_request"; from: string }
  // Host pushes the chosen format so guests' lobby preview matches.
  | { type: "config"; layoutId: string }
  | {
      type: "session_start";
      sessionId: string;
      shootAt: number; // server-clock ms of the first shot
      order: string[]; // participant user ids, frozen at start
      shots: number;
      frameCount: number;
      layoutId: string; // filter/frame/caption are chosen AFTER capture, per person
    }
  | {
      type: "frame_uploaded";
      sessionId: string;
      userId: string;
      frameIndex: number;
      path: string;
    }
  | { type: "session_cancel"; sessionId: string };

export const EVENT = "room_event";

export function roomChannel(roomId: string, userId: string): RealtimeChannel {
  const sb = getSupabase();
  return sb.channel(`room:${roomId}`, {
    config: {
      presence: { key: userId },
      broadcast: { self: true },
    },
  });
}

export function sendEvent(channel: RealtimeChannel, event: RoomEvent): void {
  void channel.send({ type: "broadcast", event: EVENT, payload: event });
}

/**
 * Estimate offset such that: serverTimeMs ≈ Date.now() + offset.
 * Used so every device converts the shared `shootAt` to its own clock.
 */
export async function getServerOffsetMs(): Promise<number> {
  try {
    const sb = getSupabase();
    const t0 = Date.now();
    const { data, error } = await sb.rpc("server_now_ms");
    const t1 = Date.now();
    if (error || data == null) return 0;
    const serverNow = Number(data) + (t1 - t0) / 2;
    return serverNow - t1;
  } catch {
    return 0;
  }
}
