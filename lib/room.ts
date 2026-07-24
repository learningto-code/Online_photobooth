import { getSupabase } from "./supabase";

export interface Room {
  id: string;
  code: string;
  host_id: string;
  name: string | null;
  status: string;
  layout: string;
  created_at: string;
  expires_at: string;
}

export interface Participant {
  room_id: string;
  user_id: string;
  display_name: string | null;
  role: string;
  joined_at: string;
}

export async function createRoom(
  name: string | null,
  layout: string,
): Promise<{ id: string; code: string }> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("create_room", { p_name: name, p_layout: layout });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { id: row.id as string, code: row.code as string };
}

/** Join by code (idempotent). Returns the room id. */
export async function joinRoom(code: string, name: string | null): Promise<string> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc("join_room", {
    p_code: code.toUpperCase(),
    p_name: name,
  });
  if (error) throw error;
  return data as string;
}

export async function fetchRoom(roomId: string): Promise<Room | null> {
  const sb = getSupabase();
  const { data } = await sb.from("rooms").select("*").eq("id", roomId).maybeSingle();
  return (data as Room) ?? null;
}

export async function fetchParticipants(roomId: string): Promise<Participant[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from("participants")
    .select("*")
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });
  return (data as Participant[]) ?? [];
}

export async function setRoomStatus(roomId: string, status: string): Promise<void> {
  const sb = getSupabase();
  await sb.from("rooms").update({ status }).eq("id", roomId);
}
