"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase";
import { ensureAnonSession } from "@/lib/auth";
import { createRoom } from "@/lib/room";

export default function RoomEntry() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = isSupabaseConfigured();

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await ensureAnonSession();
      const room = await createRoom(null, "strip-4");
      router.push(`/room/${room.code}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  function join(e: FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c) router.push(`/room/${c}`);
  }

  if (!configured) {
    return (
      <div className="flex flex-col items-center gap-3">
        <Link href="/booth" className="btn-primary px-7 py-3 text-base">
          Enter the solo booth →
        </Link>
        <p className="max-w-sm text-xs text-white/40">
          Want to shoot <em>together</em> with friends? Add a Supabase project (see{" "}
          <code>SETUP.md</code>) to enable rooms.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex flex-col items-center gap-3 sm:flex-row">
        <button onClick={() => void create()} disabled={busy} className="btn-primary px-7 py-3 text-base">
          {busy ? "Creating…" : "Create a room →"}
        </button>
        <form onSubmit={join} className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="CODE"
            maxLength={8}
            className="w-32 rounded-full border border-white/15 bg-white/5 px-4 py-3 text-center text-sm uppercase tracking-widest outline-none focus:border-pink-400"
          />
          <button type="submit" className="btn-secondary px-5 py-3">
            Join
          </button>
        </form>
      </div>
      {error && <p className="text-xs text-amber-300">{error}</p>}
      <Link href="/booth" className="btn-ghost">
        or try the solo booth →
      </Link>
    </div>
  );
}
