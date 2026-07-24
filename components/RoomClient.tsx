"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/supabase";
import { ensureAnonSession } from "@/lib/auth";
import { fetchRoom, joinRoom, Room } from "@/lib/room";
import { Centered } from "./ui";
import RoomBooth from "./RoomBooth";

const NAMES = ["Peach", "Mochi", "Bunny", "Cloud", "Star", "Ruby", "Kiwi", "Pixel", "Sunny", "Maple"];
function randomName(): string {
  return `${NAMES[Math.floor(Math.random() * NAMES.length)]} ${Math.floor(10 + Math.random() * 89)}`;
}

export default function RoomClient({ code }: { code: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [userId, setUserId] = useState("");
  const [name] = useState(() => randomName());

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let cancelled = false;
    (async () => {
      try {
        const user = await ensureAnonSession();
        const roomId = await joinRoom(code, name);
        const r = await fetchRoom(roomId);
        if (cancelled) return;
        if (!r) throw new Error("Room not found");
        setUserId(user.id);
        setRoom(r);
        setState("ready");
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, name]);

  if (!isSupabaseConfigured()) {
    return (
      <Centered>
        <p className="font-medium text-white/80">Rooms aren&apos;t set up yet</p>
        <p className="text-sm">
          Add a Supabase project (see <code>SETUP.md</code>) to shoot together. The solo booth
          works without it.
        </p>
        <div className="flex gap-2">
          <Link href="/booth" className="btn-primary">
            Solo booth
          </Link>
          <Link href="/" className="btn-secondary">
            Home
          </Link>
        </div>
      </Centered>
    );
  }

  if (state === "loading") return <Centered>Joining room {code}…</Centered>;

  if (state === "error" || !room) {
    return (
      <Centered>
        <p className="text-white/80">{error ?? "Something went wrong"}</p>
        <Link href="/" className="btn-secondary">
          Home
        </Link>
      </Centered>
    );
  }

  return <RoomBooth room={room} userId={userId} name={name} isHost={room.host_id === userId} />;
}
